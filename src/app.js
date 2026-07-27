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
    'color-ribbon-value', 'show-ribbon-value'
  ].map(id => [id, document.getElementById(id)]));

  const undoStack = [];
  const redoStack = [];
  let parsed = null;
  let persistence;
  let backgroundBeforeEdit = doc.scene.background;
  let fetchController = null;
  let searchController = null;
  let activeInspector = null;
  const inspectorButtons = [...document.querySelectorAll('[data-inspector-target]')];
  const inspectorPanels = [...document.querySelectorAll('[data-inspector-panel]')];
  const inspectorTitles = {
    fetch: 'Find structure', representation: 'Representation', color: 'Color',
    show: 'Show and hide', inspect: 'Selection inspector'
  };

  const renderer = new window.MoleculeRenderer(elements['molecule-viewer'], {
    onPick: atom => selectAtom(atom),
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
    redoStack.push(snapshot());
    restoreSnapshot(undoStack.pop());
    touchDocument('browser');
    refresh();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restoreSnapshot(redoStack.pop());
    touchDocument('browser');
    refresh();
  }

  function refresh({ fit = false } = {}) {
    try {
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

  function openInspector(name) {
    if (!inspectorTitles[name]) return;
    activeInspector = name;
    elements['inspector-title'].textContent = inspectorTitles[name];
    elements['inspector'].hidden = false;
    elements['workspace'].classList.add('inspector-open');
    for (const panel of inspectorPanels) panel.hidden = panel.dataset.inspectorPanel !== name;
    for (const button of inspectorButtons) button.setAttribute('aria-pressed', String(button.dataset.inspectorTarget === name));
  }

  function closeInspector() {
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
    commit(() => {
      doc.title = displayName;
      doc.structure = { id: Core.uid('structure'), name: displayName, format: 'pdb', data: text };
      if (options.source) doc.structure.source = structuredClone(options.source);
      doc.scene.selection = null;
      doc.scene.customColors = [];
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
    else if (event.key === 'Escape' && !elements['inspector'].hidden) closeInspector();
    else if (event.key === 'Escape') selectAtom(null);
    else if (event.key.toLowerCase() === 'r' && (document.activeElement === elements['molecule-viewer'] || elements['molecule-viewer'].contains(document.activeElement))) elements['fit-button'].click();
  });

  window.molview = Object.freeze({
    version: '0.5.0',
    get document() { return structuredClone(doc); },
    getSelection() { return structuredClone(doc.scene.selection); },
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
    loadDocument(value, modifiedBy = 'agent') {
      const next = Core.normalizeDocument(typeof value === 'string' ? JSON.parse(value) : value);
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
