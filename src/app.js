(function () {
  'use strict';

  const Core = window.MolhtmlCore;
  const Persistence = window.MolhtmlPersistence;
  const Export = window.MolhtmlExport;
  const pristine = Persistence.capturePristine();
  const embedded = document.getElementById('molhtml-doc')?.textContent?.trim();
  let doc;
  try {
    doc = Core.normalizeDocument(JSON.parse(embedded || '{}'));
  } catch (error) {
    document.getElementById('canvas-message').hidden = false;
    document.getElementById('canvas-message').textContent = `This molecular document could not be opened: ${error.message}`;
    return;
  }

  const elements = Object.fromEntries([
    'save-status', 'save-button', 'save-as-button', 'undo-button', 'redo-button',
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
    'navigator-clear-search', 'navigator-count', 'navigator-sequences', 'navigator-tree', 'navigator-status',
    'saved-selections-button', 'saved-selections-ribbon-value', 'saved-selection-name',
    'saved-selection-scope', 'create-current-selection', 'saved-selection-current-status',
    'saved-range-name', 'saved-range-chain', 'saved-range-start', 'saved-range-end',
    'create-range-selection', 'saved-ligand-name', 'create-ligand-selection',
    'saved-proximity-name', 'saved-proximity-target', 'saved-proximity-cutoff',
    'create-proximity-selection', 'clear-saved-selection-highlight',
    'empty-saved-selections', 'saved-selection-list',
    'ligands-button', 'ligands-ribbon-value', 'empty-ligands', 'ligand-analysis-controls',
    'ligand-select', 'ligand-cutoff', 'ligand-cutoff-value', 'ligand-show-ligand',
    'ligand-show-pocket', 'ligand-show-contacts', 'ligand-polar-only', 'ligand-focus',
    'ligand-analysis-note', 'ligand-analysis-summary', 'empty-pocket', 'ligand-residue-list',
    'interactions-button', 'interactions-ribbon-value', 'interactions-enabled',
    'interaction-hydrogen-bonds', 'interaction-salt-bridges', 'interaction-include-water',
    'interaction-summary', 'interaction-provenance', 'interaction-truncation',
    'interaction-legend', 'interaction-legend-hydrogen', 'interaction-legend-salt',
    'metadata-button', 'metadata-ribbon-value', 'metadata-source', 'metadata-details',
    'metadata-entities-section', 'metadata-entities', 'metadata-citation-section', 'metadata-citation',
    'quality-stats', 'quality-observations',
    'saved-views-button', 'saved-views-ribbon-value', 'create-saved-view', 'start-story',
    'saved-view-count', 'empty-saved-views', 'saved-view-list', 'story-overlay',
    'story-position', 'story-title', 'story-narrative', 'story-previous', 'story-next', 'story-autoplay',
    'story-timing', 'story-status', 'story-exit',
    'export-button', 'export-controls', 'export-options', 'export-activity', 'export-size', 'export-custom-fields', 'export-width',
    'export-height', 'export-aspect-row', 'export-lock-aspect', 'export-background', 'export-summary',
    'export-download', 'export-copy', 'export-status', 'turntable-size', 'turntable-duration',
    'turntable-direction', 'turntable-summary', 'turntable-progress', 'turntable-progress-text',
    'turntable-download', 'turntable-cancel'
  ].map(id => [id, document.getElementById(id)]));

  const undoStack = [];
  const redoStack = [];
  let parsed = null;
  let persistence;
  let backgroundBeforeEdit = doc.scene.background;
  let fetchController = null;
  let searchController = null;
  let activeInspector = null;
  let inspectorReturnFocus = null;
  let measurementDraft = null;
  let activeMeasurementId = null;
  let activeSavedSelectionId = null;
  let currentQuality = null;
  let exportActivity = null;
  let exportCustomInitialized = false;
  let pendingClipboardExport = null;
  let turntableUnsupportedReason = '';
  let turntableLiveMilestone = 0;
  let completedTurntableSummary = null;
  let rendererCanonical = false;
  const storyState = { active: false, index: 0, playing: false, timer: null };
  const STORY_STEP_DURATION_MS = 5000;
  const CUSTOM_COLOR_SELECTOR_KINDS = new Set([
    'atom', 'residue', 'chain', 'instance', 'entity', 'role', 'connected-component'
  ]);
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
    navigator: 'Structure navigator', 'saved-selections': 'Named selections',
    ligands: 'Ligands and pocket', metadata: 'Metadata and quality',
    interactions: 'Interactions',
    'saved-views': 'Saved views and story', export: 'Export'
  };

  const renderer = new window.MoleculeRenderer(elements['molecule-viewer'], {
    onPick: atom => handleAtomPick(atom),
    onCamera: camera => {
      if (storyState.active || !rendererCanonical) return;
      Core.applyDocumentCommand(doc, { type: 'set-camera', camera });
      touchDocument('browser', false);
    },
    onResize: () => {
      if (!exportActivity) completedTurntableSummary = null;
      if (activeInspector === 'export') syncExportControls();
    }
  });
  const exportService = new Export.ExportService(() => {
    const sizing = renderer.getSizingInfo();
    return {
      document: doc,
      camera: renderer.getCameraSnapshot(),
      activeMeasurementId,
      activeSavedSelectionId,
      visibleSize: {
        width: sizing.width,
        height: sizing.height,
        devicePixelRatio: sizing.devicePixelRatio
      }
    };
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

  function commit(change, { history = true, fit = false, source = 'browser', interactionOnly = false } = {}) {
    const previousDocument = structuredClone(doc);
    const previousTransientState = {
      measurementDraft: measurementDraft ? structuredClone(measurementDraft) : null,
      activeMeasurementId,
      activeSavedSelectionId
    };
    const previousSaveStatus = captureSaveStatus();
    const previousUndoStack = [...undoStack];
    const previousRedoStack = [...redoStack];
    const historySnapshot = snapshot();
    const interruption = stopStory();
    try {
      change();
      touchDocument(source, false);
      if (interactionOnly && !interruption.wasActive && rendererCanonical) {
        renderer.updateInteractions();
        syncControls();
        syncInteractions();
      } else refresh({ fit });
      if (history) {
        undoStack.push(historySnapshot);
        if (undoStack.length > 60) undoStack.shift();
        redoStack.length = 0;
      }
      syncControls();
      persistence?.schedule();
    } catch (error) {
      doc = previousDocument;
      measurementDraft = previousTransientState.measurementDraft;
      activeMeasurementId = previousTransientState.activeMeasurementId;
      activeSavedSelectionId = previousTransientState.activeSavedSelectionId;
      undoStack.splice(0, undoStack.length, ...previousUndoStack);
      redoStack.splice(0, redoStack.length, ...previousRedoStack);
      restoreDocumentFailureState(previousSaveStatus, error);
      throw error;
    } finally {
      repairStoryFocus(interruption);
    }
  }

  function dispatch(command, options = {}) {
    commit(() => { Core.applyDocumentCommand(doc, command); }, options);
    return structuredClone(doc);
  }

  function touchDocument(source = 'browser', schedule = true) {
    if (Core.requiresDocumentV2(doc)) doc.version = 2;
    doc.revision = (Number(doc.revision) || 0) + 1;
    doc.modified = new Date().toISOString();
    doc.modifiedBy = source;
    syncLiveDataBlock();
    setStatus('Unsaved changes', 'warning');
    if (schedule) persistence?.schedule();
  }

  function syncLiveDataBlock() {
    const block = document.getElementById('molhtml-doc');
    if (block) block.textContent = '\n' + JSON.stringify(doc, null, 2).replace(/</g, '\\u003c') + '\n';
  }

  function captureSaveStatus() {
    return {
      message: elements['save-status'].textContent,
      tone: elements['save-status'].dataset.tone || ''
    };
  }

  function restoreDocumentFailureState(saveStatus, originalError) {
    try { syncLiveDataBlock(); }
    catch (restorationError) {
      if (restorationError !== originalError) {
        toast(`Could not restore embedded document data: ${restorationError.message}`, 'error');
      }
    }
    setStatus(saveStatus.message, saveStatus.tone);
    restoreCanonicalAfterFailure(originalError);
  }

  function undo() {
    navigateHistory(undoStack, redoStack);
  }

  function redo() {
    navigateHistory(redoStack, undoStack);
  }

  function navigateHistory(sourceStack, destinationStack) {
    const interruption = stopStory();
    if (!sourceStack.length) {
      try {
        if (interruption.wasActive || !rendererCanonical) restoreCanonicalRenderer();
      } catch (error) {
        reportRestorationError(error);
      } finally {
        repairStoryFocus(interruption);
      }
      return;
    }
    const previousDocument = structuredClone(doc);
    const previousTransientState = {
      measurementDraft: measurementDraft ? structuredClone(measurementDraft) : null,
      activeMeasurementId,
      activeSavedSelectionId
    };
    const previousSaveStatus = captureSaveStatus();
    const previousSourceStack = [...sourceStack];
    const previousDestinationStack = [...destinationStack];
    const currentSnapshot = snapshot();
    const nextSnapshot = sourceStack[sourceStack.length - 1];
    try {
      resetMeasurementInteraction(false);
      restoreSnapshot(nextSnapshot);
      touchDocument('browser', false);
      refresh();
      sourceStack.pop();
      destinationStack.push(currentSnapshot);
      syncControls();
      persistence?.schedule();
    } catch (error) {
      doc = previousDocument;
      measurementDraft = previousTransientState.measurementDraft;
      activeMeasurementId = previousTransientState.activeMeasurementId;
      activeSavedSelectionId = previousTransientState.activeSavedSelectionId;
      sourceStack.splice(0, sourceStack.length, ...previousSourceStack);
      destinationStack.splice(0, destinationStack.length, ...previousDestinationStack);
      restoreDocumentFailureState(previousSaveStatus, error);
      throw error;
    } finally {
      repairStoryFocus(interruption);
    }
  }

  function canonicalDisplayState() {
    return { activeMeasurementId, activeSavedSelectionId };
  }

  function restoreCanonicalRenderer() {
    rendererCanonical = false;
    renderer.measurementDraft = measurementDraft?.atoms ? [...measurementDraft.atoms] : [];
    try {
      renderer.setDocument(doc, {
        writeCamera: false,
        presentationState: canonicalDisplayState()
      });
      parsed = renderer.parsed;
      rendererCanonical = true;
      elements['canvas-message'].hidden = true;
    } finally {
      renderer.setCameraWriteEnabled(true);
    }
  }

  function reportRestorationError(error) {
    toast(`Could not restore the molecular document view: ${error.message}`, 'error');
  }

  function restoreCanonicalAfterFailure(originalError) {
    try {
      restoreCanonicalRenderer();
    } catch (restorationError) {
      if (restorationError !== originalError) reportRestorationError(restorationError);
    }
  }

  function prepareCanonicalRendererAction(destination = elements['molecule-viewer']) {
    const interruption = stopStory();
    if (!interruption.wasActive && rendererCanonical) return false;
    try {
      restoreCanonicalRenderer();
      return true;
    } finally {
      repairStoryFocus(interruption, destination);
    }
  }

  function refresh({ fit = false } = {}) {
    rendererCanonical = false;
    try {
      renderer.measurementDraft = measurementDraft?.atoms ? [...measurementDraft.atoms] : [];
      renderer.setDocument(doc, { fit, presentationState: canonicalDisplayState() });
      parsed = renderer.parsed;
      rendererCanonical = true;
      syncLiveDataBlock();
      elements['canvas-message'].hidden = true;
    } catch (error) {
      elements['canvas-message'].hidden = false;
      elements['canvas-message'].textContent = `Unable to render this structure: ${error.message}`;
    }
    syncControls();
    syncSelection();
    syncMeasurements();
    syncSavedSelections();
    syncNavigator();
    syncLigandAnalysis();
    syncInteractions();
    syncMetadata();
    syncSavedViews();
    syncStory();
    syncExportControls();
  }

  function syncControls() {
    elements['structure-name'].textContent = doc.structure.name;
    const atoms = parsed?.atoms.length || 0;
    const residues = parsed ? new Set(parsed.atoms.map(atom => `${atom.model}|${atom.chain}|${atom.resi}|${atom.icode}`)).size : 0;
    const chains = parsed?.chains.length || 0;
    const instances = parsed?.topology?.instances?.length || chains;
    const instanceText = instances !== chains ? ` · ${instances} instance${instances === 1 ? '' : 's'}` : '';
    elements['structure-stats'].textContent = `${atoms.toLocaleString()} atom${atoms === 1 ? '' : 's'} · ${residues.toLocaleString()} residue${residues === 1 ? '' : 's'} · ${chains} author chain${chains === 1 ? '' : 's'}${instanceText}`;
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
      element: 'By element', chain: 'By author chain', 'author-chain': 'By author chain',
      instance: 'By instance', entity: 'By entity', role: 'By role', residue: 'By residue', uniform: 'Uniform'
    })[doc.scene.colorMode] || doc.scene.colorMode;
    elements['show-ribbon-value'].textContent = doc.scene.showHydrogens && doc.scene.showWater
      ? 'H + water' : doc.scene.showHydrogens ? 'Hydrogens' : doc.scene.showWater ? 'Water' : 'Standard';
    const measurementCount = doc.scene.measurements.length;
    elements['measurements-ribbon-value'].textContent = measurementCount
      ? `${measurementCount} saved` : 'None';
    const savedSelectionCount = doc.scene.savedSelections.length;
    elements['saved-selections-ribbon-value'].textContent = savedSelectionCount
      ? `${savedSelectionCount} saved` : 'None';
    const ligands = parsed ? Core.groupLigands(parsed, doc.structure.id) : [];
    elements['ligands-ribbon-value'].textContent = Core.findLigand(ligands, doc.scene.ligandAnalysis.selectedLigand, doc.structure.id)
      ? 'Pocket active' : ligands.length ? `${ligands.length} found` : 'None';
    const savedViewCount = doc.scene.savedViews.length;
    elements['saved-views-ribbon-value'].textContent = savedViewCount
      ? `${savedViewCount} view${savedViewCount === 1 ? '' : 's'}` : 'None';
    elements['undo-button'].disabled = !undoStack.length;
    elements['redo-button'].disabled = !redoStack.length;
  }

  function syncMetadata() {
    const metadata = doc.structure.metadata || {};
    currentQuality = parsed ? Core.deriveDataQuality(parsed, doc.structure.data) : null;
    const provenanceKind = metadata.provenance?.kind;
    const sourceLabels = {
      'rcsb-data-api': 'RCSB Data API',
      'embedded-pdb-header': 'Embedded PDB header',
      'embedded-mmcif': 'Embedded PDBx/mmCIF',
      'generated-demo': 'Generated demonstration'
    };
    const sourceLabel = sourceLabels[provenanceKind] || provenanceKind || 'Embedded document metadata';
    const fetchedDate = metadata.provenance?.fetchedAt?.slice?.(0, 10);
    elements['metadata-source'].textContent = fetchedDate ? `${sourceLabel} · ${fetchedDate}` : sourceLabel;

    const resolution = (metadata.resolutionAngstroms || []).map(value => `${Number(value).toFixed(2)} Å`).join(', ');
    const details = [
      ['Title', metadata.title || doc.structure.name],
      ['PDB ID', metadata.pdbId || doc.structure.source?.pdbId],
      ['Classification', metadata.classification],
      ['Organism', (metadata.organisms || []).join(' · ')],
      ['Experimental method', (metadata.experimentalMethods || []).join(' · ')],
      ['Resolution', resolution],
      ['Deposited', metadata.depositionDate],
      ['Released', metadata.releaseDate],
      ['Structure authors', (metadata.authors || []).join(', ')],
      ['Compound record', metadata.compoundText],
      ['Source record', metadata.sourceText]
    ];
    elements['metadata-details'].replaceChildren();
    for (const [label, value] of details) {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label;
      description.textContent = value || 'Not provided';
      description.classList.toggle('missing', !value);
      row.append(term, description);
      elements['metadata-details'].appendChild(row);
    }

    const entities = metadata.entityDescriptions || [];
    elements['metadata-entities-section'].hidden = !entities.length;
    elements['metadata-entities'].replaceChildren();
    for (const entity of entities) {
      const item = document.createElement('li');
      item.textContent = entity;
      elements['metadata-entities'].appendChild(item);
    }

    const citation = metadata.primaryCitation;
    elements['metadata-citation-section'].hidden = !citation;
    elements['metadata-citation'].replaceChildren();
    if (citation) {
      const title = document.createElement('strong');
      title.textContent = citation.title || 'Citation title not provided';
      const parts = [
        (citation.authors || []).join(', '),
        [citation.journal, citation.year].filter(Boolean).join(' '),
        citation.doi ? `DOI ${citation.doi}` : '',
        citation.pubmedId ? `PubMed ${citation.pubmedId}` : ''
      ].filter(Boolean);
      const summary = document.createElement('span');
      summary.textContent = parts.join(' · ') || 'No citation details provided';
      elements['metadata-citation'].append(title, summary);
    }

    elements['quality-stats'].replaceChildren();
    const summary = currentQuality?.summary;
    if (summary) {
      const bFactor = summary.bFactor
        ? `${summary.bFactor.min.toFixed(1)}–${summary.bFactor.max.toFixed(1)} (mean ${summary.bFactor.mean.toFixed(1)})`
        : 'Unavailable';
      const stats = [
        ['Atoms', summary.atomCount], ['Residues', summary.residueCount],
        ['Chains', summary.chainCount], ['Models', summary.modelCount],
        ['Alt-location atoms', summary.alternateLocationAtoms],
        ['Partial occupancy', summary.partialOccupancyAtoms],
        ['Zero occupancy', summary.zeroOccupancyAtoms], ['B factors', bFactor],
        ['Non-water ligands', summary.nonWaterLigandCount], ['Water residues', summary.waterResidueCount],
        ['Hydrogen atoms', summary.hydrogenAtomCount], ['Skipped coordinate lines', summary.skippedCoordinateLines]
      ];
      for (const [label, value] of stats) {
        const card = document.createElement('div');
        card.className = 'quality-stat';
        const amount = document.createElement('strong');
        amount.textContent = typeof value === 'number' ? value.toLocaleString() : value;
        const name = document.createElement('span');
        name.textContent = label;
        card.append(amount, name);
        elements['quality-stats'].appendChild(card);
      }
    }

    const observations = [
      ...(metadata.metadataWarnings || []).map(message => ({ severity: 'warning', message })),
      ...(currentQuality?.warnings || [])
    ];
    elements['quality-observations'].replaceChildren();
    if (!observations.length) {
      const item = document.createElement('div');
      item.className = 'quality-observation ok';
      item.textContent = 'No coordinate parsing or occupancy observations were detected by these local checks.';
      elements['quality-observations'].appendChild(item);
    } else {
      for (const observation of observations) {
        const item = document.createElement('div');
        item.className = `quality-observation ${observation.severity === 'warning' ? 'warning' : ''}`.trim();
        item.textContent = observation.message;
        elements['quality-observations'].appendChild(item);
      }
    }
    const warningCount = observations.filter(observation => observation.severity === 'warning').length;
    elements['metadata-ribbon-value'].textContent = warningCount
      ? `${warningCount} warning${warningCount === 1 ? '' : 's'}`
      : observations.length ? `${observations.length} observation${observations.length === 1 ? '' : 's'}` : 'No flags';
  }

  function selectedAtomResolution() {
    const selector = doc.scene.selection?.selector;
    if (!selector || !parsed) return { valid: false, error: 'Select an atom first.', atom: null };
    return Core.resolveUniqueAtomSelector(selector, parsed.atoms, doc.structure.id);
  }

  function selectedAtom() {
    const resolution = selectedAtomResolution();
    return resolution.valid ? resolution.atom : null;
  }

  function syncSelection() {
    const resolution = selectedAtomResolution();
    const atom = resolution.valid ? resolution.atom : null;
    const hasSelection = Boolean(doc.scene.selection?.selector);
    elements['empty-selection'].hidden = Boolean(atom);
    elements['selection-details'].hidden = !atom;
    elements['clear-selection'].disabled = !hasSelection;
    elements['clear-selection-panel'].disabled = !hasSelection;
    elements['inspect-button'].disabled = !atom;
    elements['create-current-selection'].disabled = !atom;
    const proximityNeedsCurrent = elements['saved-proximity-target'].value !== 'ligands';
    elements['create-proximity-selection'].disabled = proximityNeedsCurrent && !atom;
    elements['saved-selection-current-status'].textContent = atom
      ? `Current atom: ${Core.atomLabel(atom)}`
      : hasSelection ? resolution.error : 'Select an atom first.';
    const emptyTitle = elements['empty-selection'].querySelector('strong');
    const emptyDetail = elements['empty-selection'].querySelector('span');
    if (emptyTitle) emptyTitle.textContent = hasSelection ? 'Selection unavailable' : 'Click an atom';
    if (emptyDetail) emptyDetail.textContent = hasSelection
      ? resolution.error
      : 'Its exact molecular identity will be written into this HTML file.';
    if (!atom) return;
    elements['selected-element'].textContent = atom.element;
    elements['selected-element'].style.background = Core.ELEMENT_COLORS[atom.element] || '#8795a7';
    elements['selected-name'].textContent = atom.name;
    const authorChain = atom.chain === '_' ? 'No author chain' : `Author chain ${atom.chain}`;
    const standardIdentity = atom.sourceFormat === 'mmcif'
      ? ` · instance ${atom.labelAsymId || atom.instanceId} · entity ${atom.labelEntityId || atom.entityId}`
      : '';
    elements['selected-path'].textContent = `${authorChain}${standardIdentity} · ${atom.resn} ${atom.resi}${atom.icode || ''}`;
    elements['selected-serial'].textContent = atom.serial;
    elements['selected-coordinates'].textContent = `${atom.x.toFixed(2)}, ${atom.y.toFixed(2)}, ${atom.z.toFixed(2)}`;
  }

  function selectorForCurrent(scope) {
    const atom = selectedAtom();
    if (!atom) throw new Error('Select an atom first.');
    if (!['atom', 'residue', 'chain', 'instance', 'entity', 'role', 'connected-component'].includes(scope)) {
      throw new Error(`Unsupported current selection scope: ${scope}`);
    }
    const selector = { kind: scope, ...Core.selectorForAtom(atom, scope, doc.structure.id) };
    if (scope === 'atom') selector.resn = atom.resn;
    return selector;
  }

  function syncSavedSelections() {
    const savedSelections = doc.scene.savedSelections || [];
    if (activeSavedSelectionId && !savedSelections.some(saved => saved.id === activeSavedSelectionId)) {
      activeSavedSelectionId = null;
      renderer.activeSavedSelectionId = null;
    }
    elements['saved-selection-list'].replaceChildren();
    elements['empty-saved-selections'].hidden = Boolean(savedSelections.length);
    elements['clear-saved-selection-highlight'].disabled = !activeSavedSelectionId;
    syncSavedSelectionRangeChains();

    for (const saved of savedSelections) {
      const match = Core.matchSavedSelection(saved, parsed?.atoms || [], doc.structure.id);
      const card = document.createElement('article');
      card.className = `saved-selection-card${saved.id === activeSavedSelectionId ? ' active' : ''}${match.valid ? '' : ' invalid'}`;
      card.dataset.savedSelectionId = saved.id;

      const header = document.createElement('div');
      header.className = 'saved-selection-card-header';
      const name = document.createElement('input');
      name.className = 'saved-selection-name-input';
      name.type = 'text';
      name.maxLength = 80;
      name.value = saved.name;
      name.setAttribute('aria-label', `Rename ${saved.name}`);
      name.addEventListener('change', () => {
        try { renameSavedSelection(saved.id, name.value); }
        catch (error) { name.value = saved.name; toast(error.message, 'error'); }
      });
      const remove = document.createElement('button');
      remove.className = 'saved-selection-delete';
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = `Delete ${saved.name}`;
      remove.setAttribute('aria-label', `Delete ${saved.name}`);
      remove.addEventListener('click', () => removeSavedSelection(saved.id));
      header.append(name, remove);

      const summary = document.createElement('p');
      summary.className = 'saved-selection-summary';
      summary.textContent = Core.describeSavedSelector(saved.selector);
      const counts = document.createElement('p');
      counts.className = `saved-selection-match${match.valid ? (match.atomCount ? '' : ' empty') : ' invalid'}`;
      counts.textContent = match.valid
        ? match.atomCount
          ? `${match.atomCount.toLocaleString()} atom${match.atomCount === 1 ? '' : 's'} · ${match.residueCount.toLocaleString()} residue${match.residueCount === 1 ? '' : 's'}`
          : 'Valid query · no matching atoms'
        : `Invalid · ${match.error}`;

      const actions = document.createElement('div');
      actions.className = 'saved-selection-actions';
      const highlight = document.createElement('button');
      highlight.className = saved.id === activeSavedSelectionId ? 'button accent' : 'button secondary';
      highlight.type = 'button';
      highlight.disabled = !match.valid || !match.atomCount;
      highlight.textContent = saved.id === activeSavedSelectionId ? 'Highlighted' : 'Highlight & focus';
      highlight.addEventListener('click', () => toggleSavedSelectionHighlight(saved.id));
      const copy = document.createElement('button');
      copy.className = 'button secondary';
      copy.type = 'button';
      copy.textContent = 'Copy JSON';
      copy.addEventListener('click', async () => {
        await copyText(JSON.stringify(saved, null, 2));
        toast('Named selection JSON copied', 'success');
      });
      actions.append(highlight, copy);
      card.append(header, summary, counts, actions);
      elements['saved-selection-list'].appendChild(card);
    }
  }

  function syncSavedSelectionRangeChains() {
    const previous = elements['saved-range-chain'].value;
    const chains = parsed ? Core.buildStructureHierarchy(parsed) : [];
    const multipleModels = new Set(chains.map(chain => chain.model)).size > 1;
    const options = chains.map(chain => {
      const option = document.createElement('option');
      option.value = JSON.stringify([chain.model, chain.chain]);
      const chainName = chain.chain === '_' ? 'No chain' : `Chain ${chain.chain}`;
      option.textContent = `${chainName}${multipleModels ? ` · model ${chain.model}` : ''} · ${chain.residues.length} residues`;
      return option;
    });
    elements['saved-range-chain'].replaceChildren(...options);
    if (options.some(option => option.value === previous)) elements['saved-range-chain'].value = previous;
    const disabled = !options.length;
    elements['saved-range-chain'].disabled = disabled;
    elements['create-range-selection'].disabled = disabled;
  }

  function addSavedSelection(name, selector, options = {}, source = 'agent') {
    const record = Core.normalizeSavedSelections([{
      ...(options.record || {}),
      id: typeof options.id === 'string' && options.id.trim() ? options.id : Core.uid('selection'),
      name: String(name || '').trim() || Core.describeSavedSelector(selector),
      selector
    }])[0];
    if (doc.scene.savedSelections.some(saved => saved.id === record.id)) {
      throw new Error(`Named selection ${record.id} already exists.`);
    }
    const match = Core.matchSavedSelection(record, parsed?.atoms || [], doc.structure.id);
    if (!match.valid) throw new Error(match.error);
    commit(() => {
      Core.applyDocumentCommand(doc, {
        type: 'set-saved-selections', savedSelections: [...doc.scene.savedSelections, record]
      });
      activeSavedSelectionId = record.id;
    }, { source });
    return structuredClone(record);
  }

  function renameSavedSelection(id, value, source = 'browser') {
    const name = String(value || '').trim().slice(0, 80);
    if (!name) throw new Error('Named selections need a name.');
    const saved = doc.scene.savedSelections.find(record => record.id === id);
    if (!saved) throw new Error(`Named selection ${id} was not found.`);
    if (saved.name === name) return structuredClone(saved);
    commit(() => Core.applyDocumentCommand(doc, {
      type: 'set-saved-selections',
      savedSelections: doc.scene.savedSelections.map(record => record.id === id ? { ...record, name } : record)
    }), { source });
    return structuredClone(doc.scene.savedSelections.find(record => record.id === id));
  }

  function removeSavedSelection(id, source = 'browser') {
    if (!doc.scene.savedSelections.some(saved => saved.id === id)) return false;
    commit(() => {
      Core.applyDocumentCommand(doc, {
        type: 'set-saved-selections',
        savedSelections: doc.scene.savedSelections.filter(saved => saved.id !== id)
      });
      if (activeSavedSelectionId === id) activeSavedSelectionId = null;
    }, { source });
    return true;
  }

  function clearSavedSelections(source = 'agent') {
    if (!doc.scene.savedSelections.length) return false;
    commit(() => {
      Core.applyDocumentCommand(doc, { type: 'set-saved-selections', savedSelections: [] });
      activeSavedSelectionId = null;
    }, { source });
    return true;
  }

  function setSavedSelectionHighlight(id, { focus = false } = {}) {
    prepareCanonicalRendererAction();
    if (id == null) {
      activeSavedSelectionId = null;
      renderer.setActiveSavedSelection(null);
      syncSavedSelections();
      return null;
    }
    const saved = doc.scene.savedSelections.find(record => record.id === id);
    if (!saved) throw new Error(`Named selection ${id} was not found.`);
    const match = Core.matchSavedSelection(saved, parsed?.atoms || [], doc.structure.id);
    if (!match.valid) throw new Error(match.error);
    if (!match.atomCount) throw new Error('This named selection currently matches no atoms.');
    activeSavedSelectionId = id;
    renderer.setActiveSavedSelection(id);
    if (focus) renderer.focusSavedSelection(id);
    syncSavedSelections();
    return {
      id, valid: true, atomCount: match.atomCount, residueCount: match.residueCount,
      serials: match.atoms.map(atom => atom.serial)
    };
  }

  function toggleSavedSelectionHighlight(id) {
    try {
      if (activeSavedSelectionId === id) setSavedSelectionHighlight(null);
      else setSavedSelectionHighlight(id, { focus: true });
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function savedSelectionMatch(id) {
    const saved = doc.scene.savedSelections.find(record => record.id === id);
    if (!saved) throw new Error(`Named selection ${id} was not found.`);
    const match = Core.matchSavedSelection(saved, parsed?.atoms || [], doc.structure.id);
    return {
      valid: match.valid, error: match.error, atomCount: match.atomCount,
      residueCount: match.residueCount,
      atoms: match.atoms.map(atom => Core.atomIdentity(atom, doc.structure.id))
    };
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

  function ligandAnalysisResult(selector = doc.scene.ligandAnalysis.selectedLigand, cutoff = doc.scene.ligandAnalysis.cutoff) {
    return Core.analyzeLigandPocket(parsed, selector, cutoff, doc.structure.id);
  }

  function syncLigandAnalysis() {
    if (!parsed) return;
    const state = doc.scene.ligandAnalysis;
    const ligands = Core.groupLigands(parsed, doc.structure.id);
    const selected = Core.findLigand(ligands, state.selectedLigand, doc.structure.id);

    elements['empty-ligands'].hidden = Boolean(ligands.length);
    elements['ligand-analysis-controls'].hidden = !ligands.length;
    elements['ligand-select'].replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a ligand…';
    elements['ligand-select'].appendChild(placeholder);
    for (const ligand of ligands) {
      const option = document.createElement('option');
      option.value = ligand.key;
      option.textContent = `${ligand.label} (${ligand.atomCount} atom${ligand.atomCount === 1 ? '' : 's'})`;
      elements['ligand-select'].appendChild(option);
    }
    elements['ligand-select'].value = selected?.key || '';
    elements['ligand-cutoff'].value = String(state.cutoff);
    elements['ligand-cutoff-value'].textContent = `${state.cutoff.toFixed(1)} Å`;
    elements['ligand-show-ligand'].checked = state.showLigand;
    elements['ligand-show-pocket'].checked = state.showPocket;
    elements['ligand-show-contacts'].checked = state.showContacts;
    elements['ligand-polar-only'].checked = state.polarOnly;
    elements['ligand-polar-only'].disabled = !state.showContacts;
    elements['ligand-focus'].disabled = !selected;
    elements['ligand-residue-list'].replaceChildren();

    const result = ligandAnalysisResult();
    elements['empty-pocket'].hidden = !selected || Boolean(result.residues.length);
    if (!selected) {
      elements['ligand-analysis-summary'].textContent = 'Choose a ligand';
      return;
    }
    const polarCount = result.contacts.filter(contact => contact.polar).length;
    elements['ligand-analysis-summary'].textContent = `${result.residues.length} residues · ${result.contacts.length} pairs · ${polarCount} polar`;

    for (const residue of result.residues) {
      const card = document.createElement('article');
      card.className = 'ligand-residue-card';
      const focus = document.createElement('button');
      focus.className = 'ligand-residue-focus';
      focus.type = 'button';
      const text = document.createElement('span');
      const heading = document.createElement('strong');
      const chain = residue.chain === '_' ? 'no chain' : `chain ${residue.chain}`;
      heading.textContent = `${residue.resn} ${residue.resi}${residue.icode || ''} · ${chain}`;
      const detail = document.createElement('small');
      detail.textContent = `${residue.contacts.length} atom pair${residue.contacts.length === 1 ? '' : 's'} · ${residue.kind}`;
      text.append(heading, detail);
      const distance = document.createElement('span');
      distance.className = 'ligand-residue-distance';
      distance.textContent = `${residue.minimumDistance.toFixed(2)} Å`;
      focus.append(text, distance);
      focus.title = 'Select the nearest contacting atom and focus this residue';
      focus.addEventListener('click', () => {
        const atom = residue.contacts[0]?.targetAtom || residue.atoms[0];
        if (!atom) return;
        selectAtom(atom);
        renderer.focusSelector(Core.selectorForAtom(atom, 'residue', doc.structure.id));
      });
      const badges = document.createElement('div');
      badges.className = 'ligand-contact-badges';
      if (residue.hasClose) badges.appendChild(contactBadge('close'));
      if (residue.hasPolar) badges.appendChild(contactBadge('polar'));
      const contactList = document.createElement('div');
      contactList.className = 'ligand-atom-contacts';
      for (const contact of residue.contacts.slice(0, 4)) {
        const button = document.createElement('button');
        button.className = `ligand-atom-contact ${contact.classification}`;
        button.type = 'button';
        button.textContent = `${contact.ligandAtom.name}–${contact.targetAtom.name} ${contact.distance.toFixed(2)} Å · ${contact.classification}`;
        button.title = `Select ${Core.atomLabel(contact.targetAtom)}`;
        button.addEventListener('click', () => {
          selectAtom(contact.targetAtom);
          renderer.focusSelector(Core.selectorForAtom(contact.targetAtom, 'atom', doc.structure.id));
        });
        contactList.appendChild(button);
      }
      if (residue.contacts.length > 4) {
        const more = document.createElement('small');
        more.textContent = `+${residue.contacts.length - 4} more atom pairs`;
        contactList.appendChild(more);
      }
      card.append(focus, badges, contactList);
      elements['ligand-residue-list'].appendChild(card);
    }
  }

  function contactBadge(kind) {
    const badge = document.createElement('span');
    badge.className = `ligand-contact-badge ${kind}`;
    badge.textContent = kind;
    return badge;
  }

  function resolveLigand(value) {
    const ligands = Core.groupLigands(parsed, doc.structure.id);
    if (value == null || value === '') return null;
    const ligand = typeof value === 'string'
      ? ligands.find(candidate => candidate.key === value)
      : Core.findLigand(ligands, {
        ...value,
        structureId: value.structureId || doc.structure.id
      }, doc.structure.id);
    if (!ligand) throw new Error('The requested ligand instance was not found in this structure.');
    return ligand;
  }

  function setLigandAnalysis(changes = {}, source = 'browser') {
    const next = { ...doc.scene.ligandAnalysis, ...changes };
    if ('selectedLigand' in changes) next.selectedLigand = resolveLigand(changes.selectedLigand)?.selector || null;
    const normalized = Core.normalizeLigandAnalysis(next, doc.structure.id);
    commit(() => Core.applyDocumentCommand(doc, {
      type: 'set-ligand-analysis', ligandAnalysis: normalized
    }), { source });
    return structuredClone(doc.scene.ligandAnalysis);
  }

  function setInteractions(changes = {}, source = 'browser') {
    const next = {
      ...doc.scene.interactions,
      ...changes,
      types: {
        ...doc.scene.interactions.types,
        ...(changes.types && typeof changes.types === 'object' ? changes.types : {})
      }
    };
    const normalized = Core.normalizeInteractions(next);
    commit(() => Core.applyDocumentCommand(doc, {
      type: 'set-interactions', interactions: normalized
    }), { source, interactionOnly: true });
    return structuredClone(doc.scene.interactions);
  }

  function interactionResult() {
    const analysis = parsed
      ? Core.analyzeInteractions(parsed, doc.structure.id)
      : Core.analyzeInteractions(null, doc.structure.id);
    return { analysis, display: Core.selectInteractions(analysis, doc.scene.interactions) };
  }

  function syncInteractions() {
    const state = doc.scene.interactions;
    elements['interactions-enabled'].checked = state.enabled;
    elements['interaction-hydrogen-bonds'].checked = state.types.hydrogenBonds;
    elements['interaction-salt-bridges'].checked = state.types.saltBridges;
    elements['interaction-include-water'].checked = state.includeWater;
    elements['interaction-hydrogen-bonds'].disabled = !state.enabled;
    elements['interaction-salt-bridges'].disabled = !state.enabled;
    elements['interaction-include-water'].disabled = !state.enabled;
    const { analysis, display } = interactionResult();
    elements['interactions-ribbon-value'].textContent = state.enabled
      ? `${display.total.toLocaleString()} visible` : 'Off';
    elements['interaction-summary'].textContent = state.enabled
      ? `${display.total.toLocaleString()} qualifying interaction${display.total === 1 ? '' : 's'} · ${display.rendered.toLocaleString()} drawn`
      : `${analysis.counts.total.toLocaleString()} available · overlay hidden`;
    elements['interaction-provenance'].textContent = [
      `${analysis.counts.hydrogenBonds.toLocaleString()} hydrogen bond${analysis.counts.hydrogenBonds === 1 ? '' : 's'}`,
      `${analysis.counts.saltBridges.toLocaleString()} salt bridge${analysis.counts.saltBridges === 1 ? '' : 's'}`,
      `${analysis.counts.explicit.toLocaleString()} explicit`,
      `${analysis.counts.inferred.toLocaleString()} inferred`
    ].join(' · ');
    const notices = [];
    if (analysis.search.truncated) notices.push('Candidate safety limit reached; counts and displayed results are partial.');
    if (display.omitted) notices.push(`${display.omitted.toLocaleString()} qualifying interactions are omitted by the 500-line display cap.`);
    elements['interaction-truncation'].hidden = !notices.length;
    elements['interaction-truncation'].textContent = notices.join(' ');
    elements['interaction-legend'].hidden = !state.enabled || !display.rendered;
    elements['interaction-legend-hydrogen'].hidden = !state.types.hydrogenBonds;
    elements['interaction-legend-salt'].hidden = !state.types.saltBridges;
  }

  function focusLigandAnalysis() {
    prepareCanonicalRendererAction();
    const result = ligandAnalysisResult();
    if (!result.ligand) throw new Error('Choose a ligand first.');
    renderer.focusSelectors([result.ligand.selector, ...result.residues.map(residue => residue.selector)]);
    return { ligand: structuredClone(result.ligand.selector), residueCount: result.residues.length };
  }

  function serializeLigandAnalysisResult(result) {
    return {
      cutoff: result.cutoff,
      ligand: result.ligand ? {
        key: result.ligand.key, selector: result.ligand.selector, label: result.ligand.label,
        atomCount: result.ligand.atomCount, heavyAtomCount: result.ligand.heavyAtomCount
      } : null,
      residues: result.residues.map(residue => ({
        selector: residue.selector,
        label: `${residue.resn} ${residue.resi}${residue.icode || ''}`,
        kind: residue.kind, minimumDistance: residue.minimumDistance,
        contactCount: residue.contacts.length, hasClose: residue.hasClose, hasPolar: residue.hasPolar
      })),
      contacts: result.contacts.map(contact => ({
        ligandAtom: Core.selectorForAtom(contact.ligandAtom, 'atom', doc.structure.id),
        targetAtom: Core.selectorForAtom(contact.targetAtom, 'atom', doc.structure.id),
        ligandAtomLabel: Core.atomLabel(contact.ligandAtom),
        targetAtomLabel: Core.atomLabel(contact.targetAtom),
        distance: contact.distance, classification: contact.classification,
        close: contact.close, polar: contact.polar
      })),
      search: { indexedAtomCount: result.indexedAtomCount, candidatePairs: result.candidatePairs }
    };
  }

  function measurementTypeName(type) {
    return ({ distance: 'Distance', angle: 'Angle', dihedral: 'Dihedral' })[type] || 'Unknown measurement';
  }

  function startMeasurement(type = elements['measurement-type'].value) {
    prepareCanonicalRendererAction();
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
    if (render) prepareCanonicalRendererAction();
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
    prepareCanonicalRendererAction();
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
    commit(() => {
      Core.applyDocumentCommand(doc, {
        type: 'set-measurements',
        measurements: [...doc.scene.measurements, {
          id, type,
          atoms: atoms.map(atom => Core.selectorForAtom(atom, 'atom', doc.structure.id))
        }]
      });
      measurementDraft = null;
      activeMeasurementId = id;
    });
    toast(`${measurementTypeName(type)} added`, 'success');
  }

  function selectMeasurement(id) {
    prepareCanonicalRendererAction();
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
    commit(() => Core.applyDocumentCommand(doc, {
      type: 'set-measurements',
      measurements: doc.scene.measurements.map(measurement =>
        measurement.id === id ? { ...measurement, ...allowed } : measurement)
    }), { source });
    return structuredClone(doc.scene.measurements.find(measurement => measurement.id === id));
  }

  function deleteMeasurement(id, source = 'browser') {
    if (!doc.scene.measurements.some(measurement => measurement.id === id)) return false;
    commit(() => {
      Core.applyDocumentCommand(doc, {
        type: 'set-measurements',
        measurements: doc.scene.measurements.filter(measurement => measurement.id !== id)
      });
      if (activeMeasurementId === id) activeMeasurementId = null;
    }, { source });
    return true;
  }

  function clearMeasurements(source = 'browser') {
    if (!doc.scene.measurements.length) return false;
    commit(() => {
      Core.applyDocumentCommand(doc, { type: 'set-measurements', measurements: [] });
      activeMeasurementId = null;
    }, { source });
    return true;
  }

  function resolveAtomReference(reference) {
    let selector;
    if (typeof reference === 'number' || typeof reference === 'string') {
      const serial = Number(reference);
      if (!Number.isFinite(serial)) throw new Error('Atom serials must be numbers.');
      selector = { serial };
    } else if (reference && typeof reference === 'object' && !Array.isArray(reference)) {
      selector = reference.selector && typeof reference.selector === 'object' ? reference.selector : reference;
    } else {
      throw new Error('An atom reference must be a serial number or selector object.');
    }
    if (selector.structureId && selector.structureId !== doc.structure.id) {
      throw new Error('The atom reference belongs to a different structure.');
    }
    const scoped = { ...selector, structureId: selector.structureId || doc.structure.id };
    const resolution = Core.resolveUniqueAtomSelector(scoped, parsed?.atoms || [], doc.structure.id);
    if (!resolution.valid) throw new Error(resolution.error);
    return resolution.atom;
  }

  function addMeasurement(type, atomReferences, options = {}, source = 'agent') {
    const expected = Core.MEASUREMENT_ATOM_COUNTS[type];
    if (!expected) throw new Error(`Unsupported measurement type: ${type}`);
    if (!Array.isArray(atomReferences) || atomReferences.length !== expected) {
      throw new Error(`${measurementTypeName(type)} requires ${expected} atom references.`);
    }
    const atoms = atomReferences.map(resolveAtomReference);
    if (new Set(atoms.map(atom => atom.index)).size !== atoms.length) {
      throw new Error('Each measurement atom must be distinct.');
    }
    const record = {
      id: typeof options.id === 'string' && options.id.trim() ? options.id : Core.uid('measurement'),
      type,
      atoms: atoms.map(atom => Core.selectorForAtom(atom, 'atom', doc.structure.id))
    };
    if (options.label != null) record.label = String(options.label).slice(0, 80);
    if (options.note != null) record.note = String(options.note).slice(0, 500);
    commit(() => {
      Core.applyDocumentCommand(doc, {
        type: 'set-measurements', measurements: [...doc.scene.measurements, record]
      });
      activeMeasurementId = record.id;
    }, { source });
    return structuredClone(record);
  }

  function selectAtom(atom) {
    dispatch({
      type: 'set-selection',
      selection: atom ? {
        kind: 'atom',
        selector: Core.selectorForAtom(atom, 'atom', doc.structure.id),
        identity: Core.atomIdentity(atom, doc.structure.id)
      } : null
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

  function liveCamera() {
    const view = renderer.viewer?.getView?.();
    return Core.validCamera({ view }) ? { view: view.map(Number) } : structuredClone(doc.scene.camera);
  }

  function savedViewSnapshot() {
    prepareCanonicalRendererAction();
    return Core.captureSavedViewSnapshot(doc.scene, {
      camera: liveCamera(),
      activeAnalysis: activeMeasurementId
        ? { kind: 'measurement', id: activeMeasurementId }
        : null
    });
  }

  function savedViewById(id) {
    return doc.scene.savedViews.find(view => view.id === id);
  }

  function createSavedView(options = {}, source = 'browser') {
    const id = Core.uid('view');
    const view = {
      id,
      title: String(options.title || '').trim() || `View ${doc.scene.savedViews.length + 1}`,
      narrative: String(options.narrative ?? options.note ?? ''),
      order: doc.scene.savedViews.length,
      structureId: doc.structure.id,
      snapshot: savedViewSnapshot()
    };
    commit(() => Core.applyDocumentCommand(doc, {
      type: 'set-saved-views', savedViews: [...doc.scene.savedViews, view]
    }), { source });
    return structuredClone(savedViewById(id));
  }

  function updateSavedView(id, changes = {}, source = 'browser') {
    const target = savedViewById(id);
    if (!target) throw new Error(`Saved view ${id} was not found.`);
    const next = {};
    if ('title' in changes) next.title = String(changes.title || '').trim() || target.title;
    if ('narrative' in changes || 'note' in changes) {
      next.narrative = String(changes.narrative ?? changes.note ?? '');
    }
    if (changes.recapture || 'snapshot' in changes) {
      next.snapshot = 'snapshot' in changes
        ? Core.normalizeSavedViewSnapshot(changes.snapshot)
        : Core.normalizeSavedViewSnapshot({
          ...Core.normalizeSavedViewSnapshot(target.snapshot),
          ...savedViewSnapshot()
        });
      next.structureId = doc.structure.id;
    }
    commit(() => Core.applyDocumentCommand(doc, {
      type: 'set-saved-views',
      savedViews: doc.scene.savedViews.map(view => view.id === id ? { ...view, ...next } : view)
    }), { source });
    return structuredClone(savedViewById(id));
  }

  function duplicateSavedView(id, source = 'browser') {
    const sourceView = savedViewById(id);
    if (!sourceView) throw new Error(`Saved view ${id} was not found.`);
    const copy = structuredClone(sourceView);
    copy.id = Core.uid('view');
    copy.title = `${sourceView.title} copy`;
    const index = doc.scene.savedViews.indexOf(sourceView);
    commit(() => {
      const views = [...doc.scene.savedViews];
      views.splice(index + 1, 0, copy);
      Core.applyDocumentCommand(doc, {
        type: 'set-saved-views', savedViews: views.map((view, order) => ({ ...view, order }))
      });
    }, { source });
    return structuredClone(savedViewById(copy.id));
  }

  function moveSavedView(id, offset, source = 'browser') {
    if (!savedViewById(id)) throw new Error(`Saved view ${id} was not found.`);
    commit(() => Core.applyDocumentCommand(doc, {
      type: 'set-saved-views', savedViews: Core.reorderSavedViews(doc.scene.savedViews, id, offset)
    }), { source });
    return structuredClone(doc.scene.savedViews);
  }

  function deleteSavedView(id, source = 'browser') {
    if (!savedViewById(id)) return false;
    commit(() => Core.applyDocumentCommand(doc, {
      type: 'set-saved-views',
      savedViews: doc.scene.savedViews
        .filter(view => view.id !== id)
        .map((view, order) => ({ ...view, order }))
    }), { source });
    return true;
  }

  function validateSavedView(view) {
    if (!view?.structureId) throw new Error('This saved view is missing structureId.');
    if (view.structureId !== doc.structure.id) {
      throw new Error('This saved view belongs to a different structure.');
    }
    const atoms = parsed?.atoms || [];
    const validateSelector = (label, selector) => {
      const match = Core.matchSavedSelection(selector, atoms, doc.structure.id);
      if (!match.valid) throw new Error(`This saved view has an invalid ${label} selector: ${match.error}`);
    };
    if (view.snapshot?.selection != null) {
      if (!view.snapshot.selection?.selector) {
        throw new Error('This saved view contains a malformed selection selector.');
      }
      const selector = view.snapshot.selection.selector;
      const selectionKind = String(view.snapshot.selection.kind || 'atom').toLowerCase();
      const selectorKind = String(selector.kind || selectionKind).toLowerCase();
      validateSelector('selection', {
        ...selector,
        kind: selectorKind
      });
      if (selectionKind !== 'atom' || !['', 'atom'].includes(String(selector.kind || '').toLowerCase())) {
        throw new Error('This saved view has an unsupported selection selector kind.');
      }
      const resolution = Core.resolveUniqueAtomSelector(selector, atoms, doc.structure.id);
      if (!resolution.valid) {
        throw new Error(`This saved view has an invalid selection selector: ${resolution.error}`);
      }
    }
    for (const [index, rule] of (view.snapshot?.customColors || []).entries()) {
      if (!rule?.selector) throw new Error(`This saved view contains a malformed custom color selector ${index + 1}.`);
      const scope = String(rule.scope || '').toLowerCase();
      const kind = String(rule.selector.kind || scope).toLowerCase();
      validateSelector(`custom color ${index + 1}`, {
        ...rule.selector,
        kind
      });
      if (!CUSTOM_COLOR_SELECTOR_KINDS.has(scope) || !CUSTOM_COLOR_SELECTOR_KINDS.has(kind)) {
        throw new Error(`This saved view has an unsupported custom color selector kind at rule ${index + 1}.`);
      }
      if (rule.selector.kind && kind !== scope) {
        throw new Error(`This saved view has a custom color selector kind that does not match rule ${index + 1}'s scope.`);
      }
    }
    return view;
  }

  function applySavedView(id, source = 'browser') {
    const view = savedViewById(id);
    if (!view) throw new Error(`Saved view ${id} was not found.`);
    validateSavedView(view);
    const analysis = view.snapshot?.activeAnalysis;
    commit(() => {
      resetMeasurementInteraction(false);
      Core.applyDocumentCommand(doc, { type: 'apply-saved-view', snapshot: view.snapshot });
      activeMeasurementId = analysis?.kind === 'measurement'
        && doc.scene.measurements.some(measurement => measurement.id === analysis.id)
        ? analysis.id : null;
    }, { source });
    return structuredClone(doc.scene);
  }

  function syncSavedViews() {
    const views = doc.scene.savedViews || [];
    elements['saved-view-count'].textContent = `${views.length} view${views.length === 1 ? '' : 's'}`;
    elements['empty-saved-views'].hidden = Boolean(views.length);
    elements['start-story'].disabled = !views.length;
    elements['saved-view-list'].replaceChildren();
    const fragment = document.createDocumentFragment();

    for (const [index, view] of views.entries()) {
      const card = document.createElement('article');
      card.className = 'saved-view-card';
      card.dataset.savedViewId = view.id;

      const header = document.createElement('div');
      header.className = 'saved-view-card-header';
      const order = document.createElement('span');
      order.className = 'saved-view-order';
      order.textContent = String(index + 1);
      const title = document.createElement('input');
      title.className = 'saved-view-title';
      title.type = 'text';
      title.maxLength = 100;
      title.value = view.title;
      title.setAttribute('aria-label', `Title for story view ${index + 1}`);
      title.addEventListener('change', () => updateSavedView(view.id, { title: title.value }));
      const remove = document.createElement('button');
      remove.className = 'saved-view-delete';
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = `Delete ${view.title}`;
      remove.setAttribute('aria-label', `Delete ${view.title}`);
      remove.addEventListener('click', () => {
        if (confirm(`Delete saved view “${view.title}”?`)) deleteSavedView(view.id);
      });
      header.append(order, title, remove);

      const narrative = document.createElement('textarea');
      narrative.className = 'saved-view-narrative';
      narrative.maxLength = 1200;
      narrative.placeholder = 'Optional narrative shown during the story';
      narrative.value = view.narrative || '';
      narrative.setAttribute('aria-label', `Narrative for ${view.title}`);
      narrative.addEventListener('change', () => updateSavedView(view.id, { narrative: narrative.value }));

      const actions = document.createElement('div');
      actions.className = 'saved-view-actions';
      const actionDefinitions = [
        ['Apply', () => applySavedView(view.id), false, 'Apply this saved view'],
        ['Recapture', () => updateSavedView(view.id, { recapture: true }), false, 'Update from the current scene'],
        ['Duplicate', () => duplicateSavedView(view.id), false, 'Duplicate this saved view'],
        ['↑', () => moveSavedView(view.id, -1), index === 0, 'Move earlier'],
        ['↓', () => moveSavedView(view.id, 1), index === views.length - 1, 'Move later']
      ];
      for (const [label, action, disabled, titleText] of actionDefinitions) {
        const button = document.createElement('button');
        button.className = 'saved-view-action';
        button.type = 'button';
        button.textContent = label;
        button.title = titleText;
        button.disabled = disabled;
        button.addEventListener('click', action);
        actions.appendChild(button);
      }
      card.append(header, narrative, actions);
      fragment.appendChild(card);
    }
    elements['saved-view-list'].appendChild(fragment);
  }

  function renderStoryView(view) {
    validateSavedView(view);
    const presentationDoc = {
      ...doc,
      structure: doc.structure,
      scene: Core.applySavedViewSnapshot(doc.scene, view.snapshot)
    };
    const analysis = view.snapshot?.activeAnalysis;
    const presentationState = {
      activeMeasurementId: analysis?.kind === 'measurement'
        && (presentationDoc.scene.measurements || []).some(measurement => measurement.id === analysis.id)
        ? analysis.id : null,
      activeSavedSelectionId: null
    };
    rendererCanonical = false;
    renderer.setDocument(presentationDoc, { writeCamera: false, presentationState });
    parsed = renderer.parsed;
    elements['canvas-message'].hidden = true;
    return presentationDoc;
  }

  function closeInspectorForStory() {
    if (measurementDraft) cancelMeasurement(false);
    activeInspector = null;
    elements['inspector'].hidden = true;
    elements['workspace'].classList.remove('inspector-open');
    for (const panel of inspectorPanels) panel.hidden = true;
    for (const button of inspectorButtons) button.setAttribute('aria-pressed', 'false');
    inspectorReturnFocus = null;
  }

  function startStory(id) {
    const views = doc.scene.savedViews || [];
    if (!views.length) throw new Error('Capture a saved view before starting a story.');
    const requested = id ? views.findIndex(view => view.id === id) : 0;
    const targetIndex = requested >= 0 ? requested : 0;
    const replacing = storyState.active;
    const interruption = stopStory();
    if (!replacing) {
      if (!rendererCanonical) restoreCanonicalRenderer();
      renderer.flushCameraChange();
    }
    renderer.measurementDraft = [];
    try {
      renderStoryView(views[targetIndex]);
    } catch (error) {
      renderer.measurementDraft = measurementDraft?.atoms ? [...measurementDraft.atoms] : [];
      restoreCanonicalAfterFailure(error);
      if (replacing) elements['molecule-viewer'].focus();
      else repairStoryFocus(interruption);
      throw error;
    }
    closeInspectorForStory();
    storyState.active = true;
    storyState.index = targetIndex;
    storyState.playing = false;
    syncStory();
    focusInitialStoryControl();
    return structuredClone(views[targetIndex]);
  }

  function transitionStory(targetIndex, { playing = storyState.playing } = {}) {
    if (!storyState.active) return false;
    const views = doc.scene.savedViews || [];
    const target = Math.max(0, Math.min(views.length - 1, Number(targetIndex)));
    if (!views.length || target === storyState.index) return false;
    cancelStoryTimer();
    try {
      renderStoryView(views[target]);
    } catch (error) {
      stopStory();
      restoreCanonicalAfterFailure(error);
      elements['molecule-viewer'].focus();
      throw error;
    }
    storyState.index = target;
    storyState.playing = Boolean(playing) && target < views.length - 1;
    syncStory();
    scheduleStoryAdvance();
    return true;
  }

  function navigateStory(offset) {
    if (!storyState.active) return false;
    const views = doc.scene.savedViews || [];
    const target = Math.max(0, Math.min(views.length - 1, storyState.index + Number(offset || 0)));
    return transitionStory(target);
  }

  function cancelStoryTimer() {
    if (storyState.timer != null) clearTimeout(storyState.timer);
    storyState.timer = null;
  }

  function scheduleStoryAdvance() {
    cancelStoryTimer();
    const views = doc.scene.savedViews || [];
    if (!storyState.active || !storyState.playing || document.hidden || storyState.index >= views.length - 1) return;
    storyState.timer = setTimeout(() => {
      storyState.timer = null;
      const currentViews = doc.scene.savedViews || [];
      if (!storyState.active || !storyState.playing || document.hidden || storyState.index >= currentViews.length - 1) return;
      try {
        transitionStory(storyState.index + 1, { playing: true });
      } catch (error) {
        toast(error.message, 'error');
      }
    }, STORY_STEP_DURATION_MS);
  }

  function pauseStory() {
    if (!storyState.active) return false;
    cancelStoryTimer();
    storyState.playing = false;
    syncStory();
    return true;
  }

  function playStory() {
    if (!storyState.active) return false;
    const views = doc.scene.savedViews || [];
    if (views.length <= 1) return false;
    if (storyState.index === views.length - 1) {
      return transitionStory(0, { playing: true });
    }
    storyState.playing = true;
    syncStory();
    scheduleStoryAdvance();
    return true;
  }

  function toggleStoryPlayback() {
    return storyState.playing ? pauseStory() : playStory();
  }

  function storyCommandState(views) {
    if (storyState.playing) return 'playing';
    if (storyState.index === views.length - 1) return 'complete';
    return 'paused';
  }

  function syncStory() {
    const views = doc.scene.savedViews || [];
    if (!storyState.active || !views.length) {
      elements['story-overlay'].hidden = true;
      return;
    }
    const focused = document.activeElement;
    storyState.index = Math.max(0, Math.min(storyState.index, views.length - 1));
    const view = views[storyState.index];
    const atEnd = storyState.index === views.length - 1;
    const state = storyCommandState(views);
    elements['story-overlay'].hidden = false;
    elements['story-position'].textContent = `${storyState.index + 1} of ${views.length}`;
    elements['story-title'].textContent = view.title;
    const narrative = String(view.narrative || '').trim();
    elements['story-narrative'].hidden = !narrative;
    elements['story-narrative'].textContent = narrative;
    elements['story-previous'].disabled = storyState.index === 0;
    elements['story-next'].disabled = atEnd;
    const autoplay = elements['story-autoplay'];
    autoplay.disabled = views.length <= 1;
    if (state === 'playing') {
      autoplay.textContent = 'Pause';
      autoplay.setAttribute('aria-label', 'Pause autoplay');
    } else if (state === 'complete') {
      autoplay.textContent = 'Replay';
      autoplay.setAttribute('aria-label', 'Replay story from beginning');
    } else {
      autoplay.textContent = 'Play';
      autoplay.setAttribute('aria-label', 'Play autoplay');
    }
    const status = `Story view ${storyState.index + 1} of ${views.length}: ${view.title}. Autoplay ${state}.`;
    if (elements['story-status'].textContent !== status) elements['story-status'].textContent = status;
    const disabledNavigation = (focused === elements['story-previous'] && elements['story-previous'].disabled)
      || (focused === elements['story-next'] && elements['story-next'].disabled);
    if (disabledNavigation || (focused === elements['story-narrative'] && !narrative)) {
      (autoplay.disabled ? elements['story-exit'] : autoplay).focus();
    }
  }

  function focusInitialStoryControl() {
    if (!elements['story-next'].disabled) elements['story-next'].focus();
    else if (!elements['story-autoplay'].disabled) elements['story-autoplay'].focus();
    else elements['story-exit'].focus();
  }

  function stopStory() {
    const wasActive = storyState.active;
    const ownedFocus = wasActive && elements['story-overlay'].contains(document.activeElement);
    cancelStoryTimer();
    storyState.playing = false;
    storyState.active = false;
    elements['story-overlay'].hidden = true;
    return { wasActive, ownedFocus };
  }

  function repairStoryFocus(interruption, destination = elements['molecule-viewer']) {
    if (interruption?.ownedFocus && destination?.isConnected) destination.focus();
  }

  function exitStory(restoreFocus = true) {
    if (!storyState.active) return false;
    const interruption = stopStory();
    try {
      restoreCanonicalRenderer();
    } catch (error) {
      reportRestorationError(error);
    } finally {
      if (restoreFocus) elements['molecule-viewer'].focus();
      else repairStoryFocus(interruption);
    }
    return true;
  }

  function visibleExportSize() {
    const sizing = renderer.getSizingInfo();
    return { width: sizing.width, height: sizing.height };
  }

  function selectedExportOptions() {
    const visible = visibleExportSize();
    const transparent = elements['export-background'].value === 'transparent';
    const preset = elements['export-size'].value;
    if (preset === 'current') return { transparent };
    if (preset === '2' || preset === '4') {
      const scale = Number(preset);
      return { width: visible.width * scale, height: visible.height * scale, transparent };
    }
    if (elements['export-width'].value === '' || elements['export-height'].value === '') {
      throw new Export.ExportDimensionError('Enter both custom image dimensions.');
    }
    return {
      width: Number(elements['export-width'].value),
      height: Number(elements['export-height'].value),
      transparent
    };
  }

  function normalizedSelectedExport() {
    const visible = visibleExportSize();
    return Export.normalizeOptions(selectedExportOptions(), visible.width, visible.height);
  }

  function exportSelectionSignature() {
    const selected = normalizedSelectedExport();
    return `${selected.width}|${selected.height}|${selected.transparent}`;
  }

  function initializeCustomExportSize() {
    if (exportCustomInitialized) return;
    const visible = visibleExportSize();
    elements['export-width'].value = String(visible.width);
    elements['export-height'].value = String(visible.height);
    exportCustomInitialized = true;
  }

  function updateLockedExportDimension(changed) {
    if (!elements['export-lock-aspect'].checked) return;
    const visible = visibleExportSize();
    if (!visible.width || !visible.height) return;
    if (changed === 'width') {
      const width = Number(elements['export-width'].value);
      if (Number.isFinite(width)) elements['export-height'].value = String(Math.round(width * visible.height / visible.width));
    } else {
      const height = Number(elements['export-height'].value);
      if (Number.isFinite(height)) elements['export-width'].value = String(Math.round(height * visible.width / visible.height));
    }
  }

  function syncExportControls(resetStatus = false) {
    if (!elements['export-size']) return;
    const busy = Boolean(exportActivity);
    const custom = elements['export-size'].value === 'custom';
    if (custom) initializeCustomExportSize();
    elements['export-custom-fields'].hidden = !custom;
    elements['export-aspect-row'].hidden = !custom;
    elements['export-copy'].hidden = !exportService.canCopyImage();
    let imageValid = false;
    try {
      const options = normalizedSelectedExport();
      const background = options.transparent ? 'transparent' : 'scene color';
      elements['export-summary'].textContent = `${options.width.toLocaleString()} x ${options.height.toLocaleString()} px - ${background}`;
      elements['export-width'].removeAttribute('aria-invalid');
      elements['export-height'].removeAttribute('aria-invalid');
      imageValid = true;
      if (resetStatus && !busy) {
        setExportStatus(exportService.canCopyImage()
          ? 'Ready to export.'
          : 'Ready to download. Image clipboard access is unavailable in this browser.', '');
      }
    } catch (error) {
      elements['export-summary'].textContent = 'Choose valid output dimensions.';
      if (custom) {
        elements['export-width'].setAttribute('aria-invalid', 'true');
        elements['export-height'].setAttribute('aria-invalid', 'true');
      } else {
        elements['export-width'].removeAttribute('aria-invalid');
        elements['export-height'].removeAttribute('aria-invalid');
      }
      if (!busy) setExportStatus(error.message, 'error');
    }
    let videoValid = false;
    try {
      const options = exportActivity?.kind === 'video' && exportActivity.options
        ? exportActivity.options
        : normalizedSelectedTurntable();
      const capabilities = exportService.getTurntableCapabilities();
      const preferred = preferredTurntableFormat(capabilities);
      const reason = turntableUnsupportedReason || capabilities.reason;
      const advisorySummary = reason
        ? `${options.width.toLocaleString()} x ${options.height.toLocaleString()} px - ${reason}`
        : turntableSummary(options, preferred);
      const acceptedSummary = exportActivity?.kind === 'video'
        ? exportActivity.summary
        : completedTurntableSummary?.signature === turntableOptionsSignature(options)
          ? completedTurntableSummary.text
          : null;
      elements['turntable-summary'].textContent = acceptedSummary || advisorySummary;
      elements['turntable-summary'].dataset.mimeType = exportActivity?.mimeType
        || (completedTurntableSummary?.signature === turntableOptionsSignature(options)
          ? completedTurntableSummary.mimeType : '');
      videoValid = capabilities.supported && !turntableUnsupportedReason;
    } catch (error) {
      elements['turntable-summary'].textContent = error.message;
      if (!busy && imageValid) setExportStatus(error.message, 'error');
    }
    elements['export-options'].setAttribute('aria-busy', String(busy));
    for (const id of [
      'export-size', 'export-width', 'export-height', 'export-lock-aspect', 'export-background',
      'turntable-size', 'turntable-duration', 'turntable-direction'
    ]) elements[id].disabled = busy;
    elements['export-download'].disabled = busy || !imageValid;
    elements['export-copy'].disabled = busy || !imageValid;
    elements['turntable-download'].disabled = busy || !videoValid;
  }

  function selectedTurntableOptions() {
    const visible = visibleExportSize();
    const size = elements['turntable-size'].value;
    let dimensions = {
      width: Math.floor(visible.width / 2) * 2,
      height: Math.floor(visible.height / 2) * 2
    };
    if (size === '720') dimensions = Export.fitVideoDimensions(visible.width, visible.height, 1280, 720);
    else if (size === '1080') dimensions = Export.fitVideoDimensions(visible.width, visible.height, 1920, 1080);
    return {
      ...dimensions,
      durationSeconds: Number(elements['turntable-duration'].value),
      fps: 30,
      direction: elements['turntable-direction'].value
    };
  }

  function normalizedSelectedTurntable() {
    const visible = visibleExportSize();
    return Export.normalizeTurntableOptions(selectedTurntableOptions(), visible.width, visible.height);
  }

  function preferredTurntableFormat(capabilities) {
    const mime = capabilities.preferredMimeType || '';
    if (!mime) return 'Browser-selected format';
    if (mime.startsWith('video/mp4;') && mime.includes('avc1')) return 'H.264 MP4 preferred; WebM fallback';
    if (mime.startsWith('video/mp4')) return 'MP4 preferred; WebM fallback';
    if (mime.startsWith('video/webm')) return `${mime.includes('vp9') ? 'VP9 ' : mime.includes('vp8') ? 'VP8 ' : ''}WebM preferred`;
    return 'Browser-selected format';
  }

  function turntableOptionsSignature(options) {
    return [options.width, options.height, options.durationSeconds, options.fps, options.direction].join(':');
  }

  function turntableSummary(options, format) {
    return `${options.width.toLocaleString()} x ${options.height.toLocaleString()} px - ${options.durationSeconds}s at ${options.fps} fps - ${options.frameCount} frames - ${format}`;
  }

  function setExportStatus(message, tone = '') {
    elements['export-status'].textContent = message;
    elements['export-status'].dataset.tone = tone;
  }

  function setExportActivity(activity) {
    exportActivity = activity;
    const video = activity?.kind === 'video';
    const progress = activity?.progress;
    elements['turntable-cancel'].hidden = !video;
    elements['turntable-cancel'].disabled = !video || !activity.abortController || activity.abortController.signal.aborted;
    elements['turntable-progress'].hidden = !video || activity.phase === 'preparing';
    elements['turntable-progress-text'].hidden = elements['turntable-progress'].hidden;
    if (video && progress) {
      elements['turntable-progress'].max = progress.totalFrames;
      elements['turntable-progress'].value = progress.completedFrames;
      elements['turntable-progress-text'].textContent = `${progress.completedFrames} of ${progress.totalFrames} frames`;
    }
    syncExportControls();
  }

  function setExportBusy(busy) {
    setExportActivity(busy ? { kind: 'image', phase: 'preparing' } : null);
  }

  function invalidatePendingClipboardExport() {
    pendingClipboardExport = null;
    syncExportControls(true);
  }

  async function downloadExportImage() {
    let options;
    let signature;
    try {
      prepareCanonicalRendererAction();
      options = selectedExportOptions();
      signature = exportSelectionSignature();
    } catch (error) {
      setExportStatus(error.message, 'error');
      return;
    }
    setExportBusy(true);
    setExportStatus('Rendering PNG for download...');
    try {
      let result;
      if (pendingClipboardExport?.signature === signature) {
        const { blob, metadata } = pendingClipboardExport;
        const filename = exportService.downloadBlob(blob, metadata, options.filename);
        result = { status: 'downloaded', filename, ...metadata };
        pendingClipboardExport = null;
      } else result = await exportService.downloadPNG(options);
      setExportStatus(`Downloaded ${result.filename} (${result.width} x ${result.height} px).`, 'success');
      toast('PNG image downloaded', 'success');
    } catch (error) {
      setExportStatus(error.message, 'error');
      toast(error.message, 'error');
    } finally {
      setExportBusy(false);
    }
  }

  async function copyExportImage() {
    let options;
    let signature;
    try {
      prepareCanonicalRendererAction();
      options = selectedExportOptions();
      signature = exportSelectionSignature();
    } catch (error) {
      setExportStatus(error.message, 'error');
      return;
    }
    pendingClipboardExport = null;
    setExportBusy(true);
    setExportStatus('Rendering and copying PNG...');
    const outcomePromise = exportService.copyImage(options);
    try {
      const outcome = await outcomePromise;
      if (outcome.status === 'copied') {
        setExportStatus(`Copied ${outcome.metadata.width} x ${outcome.metadata.height} px PNG.`, 'success');
        toast('PNG image copied', 'success');
      } else if (outcome.status === 'denied') {
        pendingClipboardExport = { ...outcome, signature };
        setExportStatus(`${outcome.reason} Choose Download PNG to keep this rendered image.`, 'warning');
      } else {
        if (outcome.blob) pendingClipboardExport = { ...outcome, signature };
        setExportStatus(outcome.reason, 'warning');
      }
    } catch (error) {
      setExportStatus(error.message, 'error');
      toast(error.message, 'error');
    } finally {
      setExportBusy(false);
    }
  }

  function handleTurntableProgress(progress) {
    if (exportActivity?.kind !== 'video') return;
    const negotiatedMimeType = progress.phase === 'preparing' ? '' : progress.mimeType;
    const mimeType = negotiatedMimeType || exportActivity.mimeType || '';
    exportActivity = {
      ...exportActivity,
      phase: progress.phase,
      progress,
      mimeType,
      summary: mimeType
        ? turntableSummary(exportActivity.options, recordedFormatLabel(mimeType))
        : exportActivity.summary
    };
    elements['turntable-summary'].textContent = exportActivity.summary;
    elements['turntable-summary'].dataset.mimeType = mimeType;
    const showProgress = progress.phase !== 'preparing';
    elements['turntable-progress'].hidden = !showProgress;
    elements['turntable-progress-text'].hidden = !showProgress;
    elements['turntable-progress'].max = progress.totalFrames;
    elements['turntable-progress'].value = progress.completedFrames;
    elements['turntable-progress-text'].textContent = `${progress.completedFrames} of ${progress.totalFrames} frames`;
    if (progress.phase === 'recording' && turntableLiveMilestone === 0) {
      turntableLiveMilestone = 1;
      setExportStatus(`Recording ${progress.totalFrames} turntable frames...`);
    } else if (progress.phase === 'recording') {
      const milestone = progress.percent >= 75 ? 75 : progress.percent >= 50 ? 50 : progress.percent >= 25 ? 25 : 0;
      if (milestone > turntableLiveMilestone) {
        turntableLiveMilestone = milestone;
        setExportStatus(`Recording turntable video - ${milestone}% complete.`);
      }
    } else if (progress.phase === 'finalizing') {
      setExportStatus('Finalizing turntable video...');
    }
  }

  function recordedFormatLabel(mimeType) {
    const normalized = Export.normalizeMimeType(mimeType);
    if (normalized.startsWith('video/mp4;') && normalized.includes('avc1')) return 'H.264 MP4';
    if (normalized.startsWith('video/mp4')) return 'MP4';
    if (normalized.startsWith('video/webm;') && normalized.includes('vp9')) return 'VP9 WebM';
    if (normalized.startsWith('video/webm;') && normalized.includes('vp8')) return 'VP8 WebM';
    if (normalized.startsWith('video/webm')) return 'WebM';
    return 'video';
  }

  async function downloadTurntableVideo() {
    let options;
    try {
      prepareCanonicalRendererAction();
      options = normalizedSelectedTurntable();
    } catch (error) {
      setExportStatus(error.message, 'error');
      return;
    }
    const abortController = new AbortController();
    turntableLiveMilestone = 0;
    completedTurntableSummary = null;
    const capabilities = exportService.getTurntableCapabilities();
    setExportActivity({
      kind: 'video', phase: 'preparing', abortController,
      options,
      mimeType: '',
      summary: turntableSummary(options, preferredTurntableFormat(capabilities)),
      progress: { completedFrames: 0, totalFrames: options.frameCount }
    });
    setExportStatus('Preparing the molecular scene for video...');
    if (activeInspector === 'export' && !elements['inspector'].hidden) elements['turntable-cancel'].focus();
    try {
      const result = await exportService.downloadTurntable({
        ...options,
        signal: abortController.signal,
        onProgress: handleTurntableProgress
      });
      const actualSummary = turntableSummary(options, recordedFormatLabel(result.mimeType));
      completedTurntableSummary = {
        signature: turntableOptionsSignature(options),
        text: actualSummary,
        mimeType: result.mimeType
      };
      elements['turntable-summary'].textContent = actualSummary;
      elements['turntable-summary'].dataset.mimeType = result.mimeType;
      setExportStatus(
        `Downloaded ${result.filename} (${result.width} x ${result.height} px, ${recordedFormatLabel(result.mimeType)}).`,
        'success'
      );
      toast('Turntable video downloaded', 'success');
    } catch (error) {
      if (error?.code === 'export-cancelled') {
        setExportStatus(error.message || 'Turntable video export cancelled.', 'warning');
        toast('Turntable video export cancelled', 'warning');
      } else {
        if (error?.code === 'export-video-unsupported') {
          turntableUnsupportedReason = error.message;
          elements['turntable-summary'].tabIndex = -1;
        }
        setExportStatus(error.message, 'error');
        toast(error.message, 'error');
      }
    } finally {
      setExportActivity(null);
      if (activeInspector === 'export' && !elements['inspector'].hidden) {
        if (turntableUnsupportedReason) elements['turntable-summary'].focus();
        else if (!elements['turntable-download'].disabled) elements['turntable-download'].focus();
      }
    }
  }

  function cancelTurntableVideo() {
    if (exportActivity?.kind !== 'video' || !exportActivity.abortController) return;
    exportActivity.abortController.abort();
    elements['turntable-cancel'].disabled = true;
    setExportStatus('Cancelling turntable video...', 'warning');
  }

  function openInspector(name) {
    if (!inspectorTitles[name]) return;
    const interruption = stopStory();
    const destination = inspectorButtons.find(button => button.dataset.inspectorTarget === name);
    try {
      if (interruption.wasActive || !rendererCanonical) {
        try { restoreCanonicalRenderer(); }
        catch (error) { reportRestorationError(error); }
      }
      if (measurementDraft && name !== 'measurements') cancelMeasurement();
      if (elements['inspector'].hidden) {
        const returnFocus = interruption.ownedFocus ? destination : document.activeElement;
        if (returnFocus instanceof HTMLElement) inspectorReturnFocus = returnFocus;
      }
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
      if (name === 'export') syncExportControls(!exportActivity);
    } finally {
      repairStoryFocus(interruption, destination);
    }
  }

  function closeInspector() {
    if (measurementDraft) cancelMeasurement();
    activeInspector = null;
    elements['inspector'].hidden = true;
    elements['workspace'].classList.remove('inspector-open');
    for (const panel of inspectorPanels) panel.hidden = true;
    for (const button of inspectorButtons) button.setAttribute('aria-pressed', 'false');
    const returnFocus = inspectorReturnFocus;
    inspectorReturnFocus = null;
    if (returnFocus?.isConnected) returnFocus.focus();
  }

  function applySelectionColor(color, scope) {
    const atom = selectedAtom();
    if (!atom) throw new Error('Select an atom first.');
    const selector = Core.selectorForAtom(atom, scope, doc.structure.id);
    dispatch({
      type: 'add-custom-color',
      rule: {
        id: Core.uid('color'), scope, selector, color,
        label: scope === 'chain' ? `Author chain ${atom.chain}`
          : scope === 'instance' ? `Molecular instance ${atom.instanceId}`
            : scope === 'entity' ? `Entity ${atom.entityId}`
              : scope === 'role' ? `${atom.role} role`
                : scope === 'residue' ? `${atom.resn} ${atom.resi}${atom.icode || ''}` : Core.atomLabel(atom)
      }
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

  async function importStructure(name, text, options = {}) {
    const parsedCandidate = Core.parseStructure(text, options.format || name);
    const displayName = options.displayName || name.replace(/\.(pdb|ent|cif|mmcif|txt)$/i, '') || 'Imported molecule';
    const metadata = Core.mergeMetadata(parsedCandidate.metadata, options.metadata);
    const interruption = stopStory();
    const structure = { id: Core.uid('structure'), name: displayName, format: parsedCandidate.format, data: text, metadata };
    if (options.source) structure.source = structuredClone(options.source);
    try {
      commit(() => {
        resetMeasurementInteraction(false);
        activeSavedSelectionId = null;
        Core.applyDocumentCommand(doc, { type: 'replace-structure', title: displayName, structure });
      }, { history: false, fit: true });
      undoStack.length = 0; redoStack.length = 0;
      syncControls();
      toast(`Loaded ${parsedCandidate.atoms.length.toLocaleString()} atoms from ${name}`, 'success');
      return structuredClone(doc);
    } finally {
      repairStoryFocus(interruption);
    }
  }

  async function importPDB(name, text, options = {}) {
    return importStructure(name, text, { ...options, format: 'pdb' });
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
        rcsb_accession_info { deposit_date initial_release_date revision_date }
        rcsb_entry_info { resolution_combined }
        audit_author { name }
        rcsb_primary_citation {
          id
          title
          year
          journal_abbrev
          pdbx_database_id_DOI
          pdbx_database_id_PubMed
          rcsb_authors
        }
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

    fetchController?.abort();
    const controller = new AbortController();
    fetchController = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    setFetchState(`Fetching ${id} from RCSB…`, '', true);
    try {
      const candidates = [
        { format: 'pdb', extension: 'pdb', kind: 'rcsb-pdb' },
        { format: 'mmcif', extension: 'cif', kind: 'rcsb-mmcif' }
      ];
      let coordinate = null;
      for (const candidate of candidates) {
        const candidateUrl = `https://files.rcsb.org/download/${encodeURIComponent(id)}.${candidate.extension}`;
        const response = await fetch(candidateUrl, { signal: controller.signal, headers: { Accept: 'text/plain' } });
        if (response.ok) {
          coordinate = { ...candidate, url: candidateUrl, text: await response.text() };
          break;
        }
        if (response.status !== 404) throw new Error(`RCSB returned HTTP ${response.status}.`);
      }
      if (!coordinate) throw new Error(`${id} has no downloadable PDB or text mmCIF coordinate file.`);
      const { format, extension, kind, url, text } = coordinate;
      const fetchedAt = new Date().toISOString();
      let embeddedMetadata;
      try {
        const entries = await fetchEntrySummaries([id], controller.signal);
        if (!entries[0]) throw new Error(`RCSB did not return metadata for ${id}.`);
        embeddedMetadata = Core.metadataFromRCSBEntry(entries[0], { fetchedAt, coordinateUrl: url });
      } catch (metadataError) {
        if (controller.signal.aborted && fetchController !== controller) throw metadataError;
        embeddedMetadata = {
          provenance: {
            kind: format === 'mmcif' ? 'embedded-mmcif' : 'embedded-pdb-header',
            coordinateSource: kind, coordinateUrl: url, fetchedAt
          },
          metadataWarnings: [`RCSB Data API metadata was unavailable during fetch; displayed metadata is limited to the embedded coordinate file (${metadataError.message}).`]
        };
      }
      const result = await importStructure(`${id}.${extension}`, text, {
        format,
        displayName: `PDB ${id}`,
        source: { kind, pdbId: id, url, fetchedAt },
        metadata: embeddedMetadata
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

  elements['representation'].addEventListener('change', event => dispatch({ type: 'set-scene-field', field: 'representation', value: event.target.value }));
  elements['color-mode'].addEventListener('change', event => dispatch({ type: 'set-scene-field', field: 'colorMode', value: event.target.value }));
  elements['show-hydrogens'].addEventListener('change', event => dispatch({ type: 'set-scene-field', field: 'showHydrogens', value: event.target.checked }));
  elements['show-water'].addEventListener('change', event => dispatch({ type: 'set-scene-field', field: 'showWater', value: event.target.checked }));
  elements['background-color'].addEventListener('input', event => {
    prepareCanonicalRendererAction();
    Core.applyDocumentCommand(doc, { type: 'set-scene-field', field: 'background', value: event.target.value });
    elements['background-value'].textContent = event.target.value;
    renderer.render();
  });
  elements['background-color'].addEventListener('focus', () => { backgroundBeforeEdit = doc.scene.background; });
  elements['background-color'].addEventListener('change', event => {
    prepareCanonicalRendererAction();
    const next = event.target.value;
    Core.applyDocumentCommand(doc, { type: 'set-scene-field', field: 'background', value: backgroundBeforeEdit });
    dispatch({ type: 'set-scene-field', field: 'background', value: next });
    backgroundBeforeEdit = next;
  });
  elements['reset-appearance'].addEventListener('click', () => dispatch({ type: 'reset-appearance' }));
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
  elements['create-current-selection'].addEventListener('click', () => {
    try {
      const scope = elements['saved-selection-scope'].value;
      const record = addSavedSelection(
        elements['saved-selection-name'].value,
        selectorForCurrent(scope),
        {},
        'browser'
      );
      elements['saved-selection-name'].value = '';
      toast(`Saved “${record.name}”`, 'success');
    } catch (error) { toast(error.message, 'error'); }
  });
  elements['create-range-selection'].addEventListener('click', () => {
    try {
      const [model, chain] = JSON.parse(elements['saved-range-chain'].value);
      const start = Number(elements['saved-range-start'].value);
      const end = Number(elements['saved-range-end'].value);
      if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error('Enter integer start and end residue numbers.');
      const selector = {
        kind: 'residue-range', structureId: doc.structure.id, model, chain,
        start: { resi: start }, end: { resi: end }
      };
      const record = addSavedSelection(elements['saved-range-name'].value, selector, {}, 'browser');
      elements['saved-range-name'].value = '';
      toast(`Saved “${record.name}”`, 'success');
    } catch (error) { toast(error.message, 'error'); }
  });
  elements['create-ligand-selection'].addEventListener('click', () => {
    try {
      const record = addSavedSelection(elements['saved-ligand-name'].value, {
        kind: 'ligands', structureId: doc.structure.id
      }, {}, 'browser');
      elements['saved-ligand-name'].value = '';
      toast(`Saved “${record.name}”`, 'success');
    } catch (error) { toast(error.message, 'error'); }
  });
  elements['saved-proximity-target'].addEventListener('change', syncSelection);
  elements['create-proximity-selection'].addEventListener('click', () => {
    try {
      const targetType = elements['saved-proximity-target'].value;
      const target = targetType === 'ligands'
        ? { kind: 'ligands', structureId: doc.structure.id }
        : selectorForCurrent(targetType === 'current-residue' ? 'residue' : 'atom');
      const cutoff = Number(elements['saved-proximity-cutoff'].value);
      const selector = { kind: 'within', structureId: doc.structure.id, cutoff, target };
      const record = addSavedSelection(elements['saved-proximity-name'].value, selector, {}, 'browser');
      elements['saved-proximity-name'].value = '';
      toast(`Saved “${record.name}”`, 'success');
    } catch (error) { toast(error.message, 'error'); }
  });
  elements['clear-saved-selection-highlight'].addEventListener('click', () => setSavedSelectionHighlight(null));
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
  elements['ligand-select'].addEventListener('change', event => setLigandAnalysis({ selectedLigand: event.target.value }));
  elements['ligand-cutoff'].addEventListener('input', event => {
    elements['ligand-cutoff-value'].textContent = `${Number(event.target.value).toFixed(1)} Å`;
  });
  elements['ligand-cutoff'].addEventListener('change', event => setLigandAnalysis({ cutoff: Number(event.target.value) }));
  elements['ligand-show-ligand'].addEventListener('change', event => setLigandAnalysis({ showLigand: event.target.checked }));
  elements['ligand-show-pocket'].addEventListener('change', event => setLigandAnalysis({ showPocket: event.target.checked }));
  elements['ligand-show-contacts'].addEventListener('change', event => setLigandAnalysis({ showContacts: event.target.checked }));
  elements['ligand-polar-only'].addEventListener('change', event => setLigandAnalysis({ polarOnly: event.target.checked }));
  elements['ligand-focus'].addEventListener('click', () => {
    try { focusLigandAnalysis(); }
    catch (error) { toast(error.message, 'error'); }
  });
  elements['interactions-enabled'].addEventListener('change', event => setInteractions({ enabled: event.target.checked }));
  elements['interaction-hydrogen-bonds'].addEventListener('change', event => setInteractions({ types: { hydrogenBonds: event.target.checked } }));
  elements['interaction-salt-bridges'].addEventListener('change', event => setInteractions({ types: { saltBridges: event.target.checked } }));
  elements['interaction-include-water'].addEventListener('change', event => setInteractions({ includeWater: event.target.checked }));
  elements['create-saved-view'].addEventListener('click', () => {
    const view = createSavedView();
    toast(`Captured “${view.title}”`, 'success');
  });
  elements['start-story'].addEventListener('click', () => {
    try { startStory(); }
    catch (error) { toast(error.message, 'error'); }
  });
  elements['story-previous'].addEventListener('click', () => {
    try { navigateStory(-1); }
    catch (error) { toast(error.message, 'error'); }
  });
  elements['story-next'].addEventListener('click', () => {
    try { navigateStory(1); }
    catch (error) { toast(error.message, 'error'); }
  });
  elements['story-autoplay'].addEventListener('click', () => {
    try { toggleStoryPlayback(); }
    catch (error) { toast(error.message, 'error'); }
  });
  elements['story-exit'].addEventListener('click', () => exitStory());
  elements['open-file-button'].addEventListener('click', () => elements['file-input'].click());
  elements['close-inspector'].addEventListener('click', closeInspector);
  for (const button of inspectorButtons) {
    button.addEventListener('click', () => {
      const target = button.dataset.inspectorTarget;
      if (!elements['inspector'].hidden && activeInspector === target) closeInspector();
      else openInspector(target);
    });
  }
  elements['export-size'].addEventListener('change', invalidatePendingClipboardExport);
  elements['export-background'].addEventListener('change', invalidatePendingClipboardExport);
  elements['export-lock-aspect'].addEventListener('change', () => {
    if (elements['export-lock-aspect'].checked) updateLockedExportDimension('width');
    invalidatePendingClipboardExport();
  });
  elements['export-width'].addEventListener('input', () => {
    updateLockedExportDimension('width');
    invalidatePendingClipboardExport();
  });
  elements['export-height'].addEventListener('input', () => {
    updateLockedExportDimension('height');
    invalidatePendingClipboardExport();
  });
  const changeTurntableOptions = () => {
    completedTurntableSummary = null;
    syncExportControls(true);
  };
  elements['turntable-size'].addEventListener('change', changeTurntableOptions);
  elements['turntable-duration'].addEventListener('change', changeTurntableOptions);
  elements['turntable-direction'].addEventListener('change', changeTurntableOptions);
  elements['export-download'].addEventListener('click', downloadExportImage);
  elements['export-copy'].addEventListener('click', copyExportImage);
  elements['turntable-download'].addEventListener('click', downloadTurntableVideo);
  elements['turntable-cancel'].addEventListener('click', cancelTurntableVideo);
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
    try { await importStructure(file.name, await file.text()); }
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
    prepareCanonicalRendererAction();
    renderer.fit(false);
    touchDocument('browser');
    refresh();
  });
  elements['reload-button'].addEventListener('click', () => location.reload());

  window.addEventListener('keydown', event => {
    const command = event.ctrlKey || event.metaKey;
    const target = event.target;
    const editing = target instanceof HTMLElement
      && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if (command && event.key.toLowerCase() === 's') { event.preventDefault(); persistence.save(event.shiftKey); }
    else if (command && event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
    else if ((command && event.key.toLowerCase() === 'y') || (command && event.shiftKey && event.key.toLowerCase() === 'z')) { event.preventDefault(); redo(); }
    else if (storyState.active && event.key === 'Escape') { event.preventDefault(); exitStory(); }
    else if (storyState.active && !editing && event.key === 'ArrowLeft') {
      event.preventDefault();
      try { navigateStory(-1); } catch (error) { toast(error.message, 'error'); }
    }
    else if (storyState.active && !editing && event.key === 'ArrowRight') {
      event.preventDefault();
      try { navigateStory(1); } catch (error) { toast(error.message, 'error'); }
    }
    else if (event.key === 'Escape' && measurementDraft) cancelMeasurement();
    else if (event.key === 'Escape' && !elements['inspector'].hidden) closeInspector();
    else if (event.key === 'Escape') selectAtom(null);
    else if (event.key.toLowerCase() === 'r' && (document.activeElement === elements['molecule-viewer'] || elements['molecule-viewer'].contains(document.activeElement))) elements['fit-button'].click();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && storyState.active) pauseStory();
  });

  window.molhtml = Object.freeze({
    version: '0.8.0',
    get document() { return structuredClone(doc); },
    getSelection() { return structuredClone(doc.scene.selection); },
    getMeasurements() { return structuredClone(doc.scene.measurements); },
    getSavedSelections() { return structuredClone(doc.scene.savedSelections); },
    listLigands() {
      return structuredClone(Core.groupLigands(parsed, doc.structure.id).map(ligand => ({
        key: ligand.key, selector: ligand.selector, label: ligand.label,
        atomCount: ligand.atomCount, heavyAtomCount: ligand.heavyAtomCount
      })));
    },
    getLigandAnalysis() {
      const result = ligandAnalysisResult();
      return structuredClone({ state: doc.scene.ligandAnalysis, ...serializeLigandAnalysisResult(result) });
    },
    getInteractions() {
      const { analysis, display } = interactionResult();
      return structuredClone({
        state: doc.scene.interactions,
        counts: analysis.counts,
        partitionCounts: analysis.partitionCounts,
        summary: {
          total: display.total,
          rendered: display.rendered,
          omitted: display.omitted,
          partial: display.partial
        },
        interactions: analysis.interactions,
        visibleInteractions: display.interactions,
        search: analysis.search,
        classifierVersion: analysis.classifierVersion
      });
    },
    getMetadata() { return structuredClone(doc.structure.metadata); },
    getDataQuality() { return structuredClone(currentQuality); },
    getStructureSummary() {
      return structuredClone({
        format: parsed?.format || doc.structure.format,
        atomCount: parsed?.atoms.length || 0,
        residueCount: parsed?.topology?.residues?.length || 0,
        coordinateModels: parsed?.coordinateSets?.map(set => set.modelNumber) || [],
        entities: parsed?.topology?.entities?.map(entity => ({
          id: entity.id, sourceId: entity.sourceId, role: entity.role, subtype: entity.subtype,
          description: entity.description, instanceIds: entity.instanceIndices.map(index => parsed.topology.instances[index]?.id)
        })) || [],
        instances: parsed?.topology?.instances?.map(instance => ({
          id: instance.id, sourceId: instance.sourceId, entityId: parsed.topology.entities[instance.entityIndex]?.id,
          authorChains: instance.authAsymIds, role: instance.role, subtype: instance.subtype,
          identityProvenance: instance.identityProvenance
        })) || [],
        assemblies: parsed?.assemblies?.map(assembly => ({
          id: assembly.id, details: assembly.details, oligomericDetails: assembly.oligomericDetails,
          oligomericCount: assembly.oligomericCount, assemblyInstanceCount: assembly.instances.length,
          generators: assembly.generators.map(generator => ({
            asymIds: generator.asymIds, operatorExpression: generator.operatorExpression,
            operatorIds: generator.operatorIds, operatorSequences: generator.operatorSequences
          }))
        })) || [],
        diagnostics: parsed?.diagnostics || null
      });
    },
    getSavedViews() { return structuredClone(doc.scene.savedViews); },
    renderPNG(options = {}) {
      prepareCanonicalRendererAction();
      return exportService.renderPNG(options);
    },
    downloadPNG(options = {}) {
      prepareCanonicalRendererAction();
      return exportService.downloadPNG(options);
    },
    copyImage(options = {}) {
      prepareCanonicalRendererAction();
      return exportService.copyImage(options);
    },
    renderTurntable(options = {}) {
      prepareCanonicalRendererAction();
      return exportService.renderTurntable(options);
    },
    downloadTurntable(options = {}) {
      prepareCanonicalRendererAction();
      return exportService.downloadTurntable(options);
    },
    getTurntableCapabilities() { return exportService.getTurntableCapabilities(); },
    serialize() { return persistence.serialize(); },
    async save() { return persistence.save(false); },
    async importStructure(name, text, format) { return importStructure(name, text, { format }); },
    async importPDB(name, text) { return importPDB(name, text); },
    async fetchStructure(id) { return fetchPDB(id); },
    async fetchPDB(id) { return fetchPDB(id); },
    async searchPDB(query) { return searchPDB(query); },
    selectAtom(reference) {
      const atom = resolveAtomReference(reference);
      selectAtom(atom);
      return structuredClone(doc.scene.selection);
    },
    colorSelection(color, scope = 'atom') { applySelectionColor(color, scope); },
    beginMeasurement(type) {
      openInspector('measurements');
      return startMeasurement(type);
    },
    cancelMeasurement() { return cancelMeasurement(); },
    addMeasurement(type, atomReferences, options) { return addMeasurement(type, atomReferences, options, 'agent'); },
    updateMeasurement(id, changes) { return updateMeasurement(id, changes || {}, 'agent'); },
    removeMeasurement(id) { return deleteMeasurement(id, 'agent'); },
    clearMeasurements() { return clearMeasurements('agent'); },
    addSavedSelection(name, selector, options) { return addSavedSelection(name, selector, options || {}, 'agent'); },
    saveCurrentSelection(name, scope = 'atom', options) {
      return addSavedSelection(name, selectorForCurrent(scope), options || {}, 'agent');
    },
    renameSavedSelection(id, name) { return renameSavedSelection(id, name, 'agent'); },
    removeSavedSelection(id) { return removeSavedSelection(id, 'agent'); },
    clearSavedSelections() { return clearSavedSelections('agent'); },
    getSavedSelectionMatch(id) { return savedSelectionMatch(id); },
    highlightSavedSelection(id, focus = false) { return setSavedSelectionHighlight(id, { focus }); },
    clearSavedSelectionHighlight() { return setSavedSelectionHighlight(null); },
    selectLigand(value) { return setLigandAnalysis({ selectedLigand: value }, 'agent'); },
    setLigandAnalysis(changes) { return setLigandAnalysis(changes || {}, 'agent'); },
    clearLigandAnalysis() { return setLigandAnalysis({ selectedLigand: null }, 'agent'); },
    focusLigandAnalysis() { return focusLigandAnalysis(); },
    analyzeLigand(value, cutoff) {
      const ligand = value == null ? resolveLigand(doc.scene.ligandAnalysis.selectedLigand) : resolveLigand(value);
      if (!ligand) throw new Error('Choose a ligand first.');
      const result = Core.analyzeLigandPocket(
        parsed, ligand.selector, cutoff ?? doc.scene.ligandAnalysis.cutoff, doc.structure.id
      );
      return structuredClone(serializeLigandAnalysisResult(result));
    },
    setInteractions(changes) { return setInteractions(changes || {}, 'agent'); },
    createSavedView(options) { return createSavedView(options || {}, 'agent'); },
    updateSavedView(id, changes) { return updateSavedView(id, changes || {}, 'agent'); },
    recaptureSavedView(id) { return updateSavedView(id, { recapture: true }, 'agent'); },
    applySavedView(id) { return applySavedView(id, 'agent'); },
    moveSavedView(id, offset) { return moveSavedView(id, offset, 'agent'); },
    duplicateSavedView(id) { return duplicateSavedView(id, 'agent'); },
    removeSavedView(id) { return deleteSavedView(id, 'agent'); },
    startStory(id) { return startStory(id); },
    previousStoryView() { return navigateStory(-1); },
    nextStoryView() { return navigateStory(1); },
    exitStory() { return exitStory(); },
    loadDocument(value, modifiedBy = 'agent') {
      const next = Core.normalizeDocument(typeof value === 'string' ? JSON.parse(value) : value);
      const interruption = stopStory();
      const previousDocument = structuredClone(doc);
      const previousTransientState = {
        measurementDraft: measurementDraft ? structuredClone(measurementDraft) : null,
        activeMeasurementId,
        activeSavedSelectionId
      };
      const previousSaveStatus = captureSaveStatus();
      const previousUndoStack = [...undoStack];
      const previousRedoStack = [...redoStack];
      try {
        resetMeasurementInteraction(false);
        activeSavedSelectionId = null;
        const historySnapshot = snapshot();
        doc = next;
        touchDocument(modifiedBy, false);
        refresh({ fit: false });
        undoStack.push(historySnapshot); redoStack.length = 0;
        syncControls();
        persistence?.schedule();
        return structuredClone(doc);
      } catch (error) {
        doc = previousDocument;
        measurementDraft = previousTransientState.measurementDraft;
        activeMeasurementId = previousTransientState.activeMeasurementId;
        activeSavedSelectionId = previousTransientState.activeSavedSelectionId;
        undoStack.splice(0, undoStack.length, ...previousUndoStack);
        redoStack.splice(0, redoStack.length, ...previousRedoStack);
        restoreDocumentFailureState(previousSaveStatus, error);
        throw error;
      } finally {
        repairStoryFocus(interruption);
      }
    }
  });

  refresh();
  const recoveryDocumentId = doc.documentId;
  persistence.recoveryFor(doc).then(recovered => {
    const recoveredRevision = Number(recovered?.revision);
    if (!recovered
      || !Number.isFinite(recoveredRevision)
      || recovered.documentId !== recoveryDocumentId
      || doc.documentId !== recoveryDocumentId
      || recoveredRevision <= Number(doc.revision)) return;
    if (confirm(`A newer browser recovery exists for “${doc.title}” (revision ${recoveredRevision}). Restore it?`)) {
      const next = Core.normalizeDocument(recovered);
      const interruption = stopStory();
      const previousDocument = doc;
      const previousTransientState = {
        measurementDraft: measurementDraft ? structuredClone(measurementDraft) : null,
        activeMeasurementId,
        activeSavedSelectionId
      };
      const previousSaveStatus = captureSaveStatus();
      const previousUndoStack = [...undoStack];
      const previousRedoStack = [...redoStack];
      try {
        resetMeasurementInteraction(false);
        activeSavedSelectionId = null;
        doc = next;
        undoStack.length = 0;
        redoStack.length = 0;
        syncLiveDataBlock();
        refresh();
      } catch (error) {
        doc = previousDocument;
        measurementDraft = previousTransientState.measurementDraft;
        activeMeasurementId = previousTransientState.activeMeasurementId;
        activeSavedSelectionId = previousTransientState.activeSavedSelectionId;
        undoStack.splice(0, undoStack.length, ...previousUndoStack);
        redoStack.splice(0, redoStack.length, ...previousRedoStack);
        restoreDocumentFailureState(previousSaveStatus, error);
        throw error;
      } finally {
        repairStoryFocus(interruption);
      }
      toast('Recovered newer browser autosave', 'success');
    }
  }).catch(error => {
    toast(`Could not restore browser autosave: ${error.message}`, 'error');
  });
})();
