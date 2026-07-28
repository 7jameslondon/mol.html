(function () {
  'use strict';

  const ELEMENT_COLORS = {
    H: '#f4f7fb', C: '#8492a6', N: '#4f7cff', O: '#ff4d5e', F: '#56d68b',
    P: '#ff9f43', S: '#ffd43b', CL: '#38d47a', BR: '#a85c3f', I: '#7b3fa1',
    FE: '#d17835', MG: '#31c48d', ZN: '#8b95a5', CA: '#5fd3bc'
  };
  const CHAIN_COLORS = ['#54a7ff', '#ff6b8a', '#63d7a5', '#ffc857', '#a98bff', '#44d6e8', '#ff9364'];
  const COVALENT_RADII = { H: .31, C: .76, N: .71, O: .66, F: .57, P: 1.07, S: 1.05, CL: 1.02, BR: 1.2, I: 1.39, FE: 1.24, MG: 1.3, ZN: 1.22, CA: 1.76 };
  const VDW_RADII = { H: 1.2, C: 1.7, N: 1.55, O: 1.52, F: 1.47, P: 1.8, S: 1.8, CL: 1.75, BR: 1.85, I: 1.98, FE: 1.8, MG: 1.73, ZN: 1.39, CA: 2.31 };
  const WATER_NAMES = new Set(['HOH', 'WAT', 'H2O', 'DOD']);
  const POLAR_ELEMENTS = new Set(['N', 'O', 'S']);
  const LIGAND_ANALYSIS_DEFAULTS = Object.freeze({
    cutoff: 4, showLigand: true, showPocket: true, showContacts: true, polarOnly: false
  });
  const MEASUREMENT_ATOM_COUNTS = Object.freeze({ distance: 2, angle: 3, dihedral: 4 });
  const REPRESENTATIONS = new Set(['cartoon', 'ball-and-stick', 'sticks', 'spacefill', 'lines', 'surface']);
  const COLOR_MODES = new Set(['element', 'chain', 'residue', 'uniform']);
  const SAVED_VIEW_SCENE_FIELDS = Object.freeze([
    'representation', 'colorMode', 'background', 'showHydrogens', 'showWater',
    'selection', 'customColors', 'activeAnalysis', 'analysisHighlight',
    'highlight', 'highlights', 'activeHighlight', 'activeLigandId', 'ligandHighlight'
  ]);
  const AMINO_ACID_CODES = Object.freeze({
    ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E',
    GLY: 'G', HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F',
    PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', SEC: 'U',
    PYL: 'O', ASX: 'B', GLX: 'Z', MSE: 'M'
  });
  const NUCLEOTIDE_CODES = Object.freeze({
    A: 'A', C: 'C', G: 'G', T: 'T', U: 'U', I: 'I',
    DA: 'A', DC: 'C', DG: 'G', DT: 'T', DU: 'U', DI: 'I',
    ADE: 'A', CYT: 'C', GUA: 'G', THY: 'T', URA: 'U'
  });

  function uid(prefix = 'id') {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function inferElement(rawName, explicit) {
    const stated = (explicit || '').trim().toUpperCase();
    if (stated) return stated;
    const raw = rawName || '';
    const clean = raw.replace(/[0-9'\s]/g, '').toUpperCase();
    if (!clean) return 'C';
    if (/^\s/.test(raw)) return clean[0];
    const pair = clean.slice(0, 2);
    return COVALENT_RADII[pair] ? pair : clean[0];
  }

  function compactStrings(values) {
    return [...new Set((values || []).map(value => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
  }

  function parsePDBDate(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{2})-([A-Z]{3})-(\d{2})$/i);
    if (!match) return raw;
    const months = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
    const month = months[match[2].toUpperCase()];
    if (!month) return raw;
    const year = Number(match[3]);
    return `${year >= 50 ? 1900 + year : 2000 + year}-${month}-${match[1]}`;
  }

  function recordText(lines, record) {
    return lines.filter(line => line.slice(0, 6).trim().toUpperCase() === record)
      .map(line => line.slice(10, 80).replace(/^\s*\d+\s+/, '').trim())
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeMetadata(value) {
    const metadata = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
    for (const key of ['organisms', 'experimentalMethods', 'authors', 'entityDescriptions', 'metadataWarnings']) {
      if (key in metadata) metadata[key] = compactStrings(Array.isArray(metadata[key]) ? metadata[key] : [metadata[key]]);
    }
    if ('resolutionAngstroms' in metadata) {
      const values = Array.isArray(metadata.resolutionAngstroms) ? metadata.resolutionAngstroms : [metadata.resolutionAngstroms];
      metadata.resolutionAngstroms = [...new Set(values.map(Number).filter(value => Number.isFinite(value) && value > 0))];
    }
    if (metadata.primaryCitation && typeof metadata.primaryCitation === 'object' && !Array.isArray(metadata.primaryCitation)) {
      metadata.primaryCitation = { ...metadata.primaryCitation };
      if ('authors' in metadata.primaryCitation) metadata.primaryCitation.authors = compactStrings(metadata.primaryCitation.authors);
    }
    if (metadata.identifiers && typeof metadata.identifiers === 'object' && !Array.isArray(metadata.identifiers)) {
      metadata.identifiers = { ...metadata.identifiers };
      if (Array.isArray(metadata.identifiers.databaseReferences)) {
        metadata.identifiers.databaseReferences = metadata.identifiers.databaseReferences
          .filter(reference => reference && typeof reference === 'object' && !Array.isArray(reference))
          .map(reference => ({ ...reference }));
      }
    }
    if (metadata.provenance && typeof metadata.provenance === 'object' && !Array.isArray(metadata.provenance)) {
      metadata.provenance = { ...metadata.provenance };
    }
    if (metadata.flags && typeof metadata.flags === 'object' && !Array.isArray(metadata.flags)) metadata.flags = { ...metadata.flags };
    return metadata;
  }

  function mergeMetadata(base, override) {
    const left = normalizeMetadata(base);
    const right = normalizeMetadata(override);
    const merged = { ...left, ...right };
    for (const key of ['primaryCitation', 'identifiers', 'provenance', 'flags']) {
      if (left[key] && right[key] && typeof left[key] === 'object' && typeof right[key] === 'object') {
        merged[key] = { ...left[key], ...right[key] };
      }
    }
    return normalizeMetadata(merged);
  }

  function parsePDBMetadata(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const metadata = { provenance: { kind: 'embedded-pdb-header' } };
    const header = lines.find(line => line.slice(0, 6).trim().toUpperCase() === 'HEADER');
    if (header) {
      const classification = header.slice(10, 50).trim();
      const depositionDate = parsePDBDate(header.slice(50, 59));
      const pdbId = header.slice(62, 66).trim().toUpperCase();
      if (classification) metadata.classification = classification;
      if (depositionDate) metadata.depositionDate = depositionDate;
      if (pdbId) metadata.pdbId = pdbId;
    }

    const title = recordText(lines, 'TITLE');
    const compoundText = recordText(lines, 'COMPND');
    const sourceText = recordText(lines, 'SOURCE');
    const experimentalText = recordText(lines, 'EXPDTA');
    const authorText = recordText(lines, 'AUTHOR');
    if (title) metadata.title = title;
    if (compoundText) metadata.compoundText = compoundText;
    if (sourceText) metadata.sourceText = sourceText;
    if (experimentalText) metadata.experimentalMethods = compactStrings(experimentalText.split(';'));
    if (authorText) metadata.authors = compactStrings(authorText.split(','));

    const organisms = [];
    for (const match of sourceText.matchAll(/ORGANISM_SCIENTIFIC\s*:\s*([^;]+)/gi)) organisms.push(match[1]);
    if (organisms.length) metadata.organisms = compactStrings(organisms);
    const descriptions = [];
    for (const match of compoundText.matchAll(/MOLECULE\s*:\s*([^;]+)/gi)) descriptions.push(match[1]);
    if (descriptions.length) metadata.entityDescriptions = compactStrings(descriptions);

    const resolutionValues = [];
    for (const line of lines) {
      if (!/^REMARK\s+2\s/i.test(line)) continue;
      const match = line.match(/RESOLUTION\.\s+([0-9]+(?:\.[0-9]+)?)\s+ANGSTROMS/i);
      if (match) resolutionValues.push(Number(match[1]));
    }
    if (resolutionValues.length) metadata.resolutionAngstroms = resolutionValues;

    const databaseReferences = [];
    for (const line of lines) {
      if (line.slice(0, 6).trim().toUpperCase() !== 'DBREF') continue;
      const reference = {
        chain: line.slice(12, 13).trim() || '_',
        database: line.slice(26, 32).trim(),
        accession: line.slice(33, 41).trim(),
        idCode: line.slice(42, 54).trim()
      };
      if (reference.database || reference.accession || reference.idCode) databaseReferences.push(reference);
    }

    const journal = {};
    const journalParts = new Map();
    for (const line of lines) {
      if (line.slice(0, 6).trim().toUpperCase() !== 'JRNL') continue;
      const key = line.slice(12, 16).trim().toUpperCase();
      const value = line.slice(19, 79).trim();
      if (!key || !value) continue;
      if (!journalParts.has(key)) journalParts.set(key, []);
      journalParts.get(key).push(value);
    }
    const journalValue = key => (journalParts.get(key) || []).join(' ').replace(/\s+/g, ' ').trim();
    const citationTitle = journalValue('TITL');
    const citationAuthors = compactStrings(journalValue('AUTH').split(','));
    const journalReference = journalValue('REF');
    const doi = journalValue('DOI');
    const pubmedId = journalValue('PMID');
    if (citationTitle) journal.title = citationTitle;
    if (citationAuthors.length) journal.authors = citationAuthors;
    if (journalReference) journal.journal = journalReference;
    if (doi) journal.doi = doi;
    if (pubmedId) journal.pubmedId = pubmedId;
    if (Object.keys(journal).length) metadata.primaryCitation = journal;

    const identifiers = {};
    if (metadata.pdbId) identifiers.pdbId = metadata.pdbId;
    if (doi) identifiers.doi = doi;
    if (pubmedId) identifiers.pubmedId = pubmedId;
    if (databaseReferences.length) identifiers.databaseReferences = databaseReferences;
    if (Object.keys(identifiers).length) metadata.identifiers = identifiers;

    const syntheticRemark = lines.find(line => /^REMARK\s/i.test(line) && /(?:synthetic|demonstration|\bdemo\b|illustrative|not (?:for )?scientific analysis)/i.test(line));
    if (syntheticRemark) {
      metadata.flags = { syntheticDemo: true, syntheticDemoRemark: syntheticRemark.slice(10).trim() };
    }
    return normalizeMetadata(metadata);
  }

  function metadataFromRCSBEntry(entry, provenance = {}) {
    const metadata = {};
    if (entry?.rcsb_id) metadata.pdbId = String(entry.rcsb_id).toUpperCase();
    if (entry?.struct?.title) metadata.title = entry.struct.title;
    const methods = compactStrings((entry?.exptl || []).map(item => item?.method));
    if (methods.length) metadata.experimentalMethods = methods;
    const resolutions = (entry?.rcsb_entry_info?.resolution_combined || []).map(Number).filter(value => Number.isFinite(value) && value > 0);
    if (resolutions.length) metadata.resolutionAngstroms = resolutions;
    const accession = entry?.rcsb_accession_info || {};
    if (accession.deposit_date) metadata.depositionDate = String(accession.deposit_date).slice(0, 10);
    if (accession.initial_release_date) metadata.releaseDate = String(accession.initial_release_date).slice(0, 10);
    if (accession.revision_date) metadata.revisionDate = String(accession.revision_date).slice(0, 10);
    const entities = entry?.polymer_entities || [];
    const descriptions = compactStrings(entities.map(entity => entity?.rcsb_polymer_entity?.pdbx_description));
    const organisms = compactStrings(entities.flatMap(entity => (entity?.rcsb_entity_source_organism || []).map(source => source?.ncbi_scientific_name)));
    if (descriptions.length) metadata.entityDescriptions = descriptions;
    if (organisms.length) metadata.organisms = organisms;
    const structureAuthors = compactStrings((entry?.audit_author || []).map(author => author?.name));
    if (structureAuthors.length) metadata.authors = structureAuthors;

    const citation = entry?.rcsb_primary_citation
      || (entry?.citation || []).find(item => String(item?.id || '').toLowerCase() === 'primary')
      || entry?.citation?.[0];
    if (citation) {
      const primaryCitation = {};
      if (citation.title) primaryCitation.title = citation.title;
      const citationAuthors = compactStrings(citation.rcsb_authors || []);
      if (citationAuthors.length) primaryCitation.authors = citationAuthors;
      if (citation.journal_abbrev) primaryCitation.journal = citation.journal_abbrev;
      if (citation.year != null) primaryCitation.year = Number(citation.year) || citation.year;
      if (citation.pdbx_database_id_DOI) primaryCitation.doi = citation.pdbx_database_id_DOI;
      if (citation.pdbx_database_id_PubMed) primaryCitation.pubmedId = String(citation.pdbx_database_id_PubMed);
      if (Object.keys(primaryCitation).length) metadata.primaryCitation = primaryCitation;
    }
    const identifiers = {};
    if (metadata.pdbId) identifiers.pdbId = metadata.pdbId;
    if (metadata.primaryCitation?.doi) identifiers.doi = metadata.primaryCitation.doi;
    if (metadata.primaryCitation?.pubmedId) identifiers.pubmedId = metadata.primaryCitation.pubmedId;
    if (Object.keys(identifiers).length) metadata.identifiers = identifiers;
    metadata.provenance = {
      kind: 'rcsb-data-api',
      url: 'https://data.rcsb.org/graphql',
      ...provenance
    };
    return normalizeMetadata(metadata);
  }

  function parsePDB(text) {
    const atoms = [];
    const explicitBonds = new Set();
    const serialMap = new Map();
    let model = 1;
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const diagnostics = { coordinateLines: 0, skippedCoordinateLines: 0, malformedCoordinateLines: 0, malformedLineNumbers: [] };

    let lineNumber = 0;
    for (const line of lines) {
      lineNumber++;
      const record = line.slice(0, 6).trim().toUpperCase();
      if (record === 'MODEL') {
        model = Number.parseInt(line.slice(10, 14), 10) || model;
        continue;
      }
      if (record === 'ATOM' || record === 'HETATM') {
        diagnostics.coordinateLines++;
        const serial = Number.parseInt(line.slice(6, 11), 10) || atoms.length + 1;
        const rawName = line.slice(12, 16);
        const atom = {
          index: atoms.length,
          serial,
          name: rawName.trim() || 'X',
          altLoc: line.slice(16, 17).trim(),
          resn: line.slice(17, 20).trim() || 'UNK',
          chain: line.slice(21, 22).trim() || '_',
          resi: Number.parseInt(line.slice(22, 26), 10) || 0,
          icode: line.slice(26, 27).trim(),
          x: Number.parseFloat(line.slice(30, 38)),
          y: Number.parseFloat(line.slice(38, 46)),
          z: Number.parseFloat(line.slice(46, 54)),
          occupancy: Number.parseFloat(line.slice(54, 60)) || 0,
          bfactor: Number.parseFloat(line.slice(60, 66)) || 0,
          element: inferElement(rawName, line.slice(76, 78)),
          het: record === 'HETATM',
          model
        };
        if ([atom.x, atom.y, atom.z].every(Number.isFinite)) {
          atoms.push(atom);
          serialMap.set(serial, atom.index);
        } else {
          diagnostics.skippedCoordinateLines++;
          diagnostics.malformedCoordinateLines++;
          if (diagnostics.malformedLineNumbers.length < 20) diagnostics.malformedLineNumbers.push(lineNumber);
        }
        continue;
      }
      if (record === 'CONECT') {
        const values = line.slice(6).match(/.{1,5}/g)?.map(v => Number.parseInt(v, 10)).filter(Number.isFinite) || [];
        const source = values.shift();
        for (const target of values) {
          if (source === target) continue;
          explicitBonds.add(source < target ? `${source}:${target}` : `${target}:${source}`);
        }
      }
    }

    if (!atoms.length) throw new Error('No ATOM or HETATM coordinates were found in this PDB file.');
    const bonds = [];
    for (const key of explicitBonds) {
      const [aSerial, bSerial] = key.split(':').map(Number);
      if (serialMap.has(aSerial) && serialMap.has(bSerial)) bonds.push([serialMap.get(aSerial), serialMap.get(bSerial)]);
    }
    inferBonds(atoms, bonds);
    return {
      atoms, bonds, chains: [...new Set(atoms.map(a => a.chain))],
      metadata: parsePDBMetadata(text), diagnostics
    };
  }

  function deriveDataQuality(value, pdbText = '') {
    const parsed = Array.isArray(value) ? { atoms: value } : (value || { atoms: [] });
    const atoms = Array.isArray(parsed.atoms) ? parsed.atoms : [];
    const diagnostics = parsed.diagnostics || { coordinateLines: atoms.length, skippedCoordinateLines: 0, malformedCoordinateLines: 0, malformedLineNumbers: [] };
    const residues = new Set();
    const chains = new Set();
    const models = new Set();
    const ligands = new Set();
    const waters = new Set();
    let alternateLocationAtoms = 0;
    let partialOccupancyAtoms = 0;
    let zeroOccupancyAtoms = 0;
    let hydrogenAtoms = 0;
    let bFactorCount = 0;
    let bFactorTotal = 0;
    let bFactorMin = Infinity;
    let bFactorMax = -Infinity;
    for (const atom of atoms) {
      const residueKey = `${atom.model}|${atom.chain}|${atom.resi}|${atom.icode}|${atom.resn}`;
      residues.add(residueKey);
      chains.add(atom.chain);
      models.add(atom.model);
      if (atom.altLoc) alternateLocationAtoms++;
      if (Number(atom.occupancy) === 0) zeroOccupancyAtoms++;
      else if (Number(atom.occupancy) > 0 && Number(atom.occupancy) < 1) partialOccupancyAtoms++;
      if (String(atom.element).toUpperCase() === 'H') hydrogenAtoms++;
      if (Number.isFinite(Number(atom.bfactor))) {
        const value = Number(atom.bfactor);
        bFactorCount++;
        bFactorTotal += value;
        bFactorMin = Math.min(bFactorMin, value);
        bFactorMax = Math.max(bFactorMax, value);
      }
      if (isWater(atom)) waters.add(residueKey);
      else if (atom.het) ligands.add(residueKey);
    }
    const bFactor = bFactorCount ? {
      min: bFactorMin, max: bFactorMax,
      mean: bFactorTotal / bFactorCount
    } : null;
    const metadata = parsed.metadata || parsePDBMetadata(pdbText);
    const summary = {
      atomCount: atoms.length,
      residueCount: residues.size,
      chainCount: chains.size,
      modelCount: models.size,
      alternateLocationAtoms,
      partialOccupancyAtoms,
      zeroOccupancyAtoms,
      bFactor,
      nonWaterLigandCount: ligands.size,
      waterResidueCount: waters.size,
      hydrogenAtomCount: hydrogenAtoms,
      coordinateLineCount: Number(diagnostics.coordinateLines) || atoms.length,
      skippedCoordinateLines: Number(diagnostics.skippedCoordinateLines) || 0,
      malformedCoordinateLines: Number(diagnostics.malformedCoordinateLines) || 0
    };
    const warnings = [];
    if (metadata.flags?.syntheticDemo) warnings.push({ code: 'synthetic-demo', severity: 'warning', message: metadata.flags.syntheticDemoRemark || 'The PDB remarks identify these coordinates as synthetic or for demonstration.' });
    if (summary.skippedCoordinateLines) warnings.push({ code: 'skipped-coordinate-lines', severity: 'warning', message: `${summary.skippedCoordinateLines} coordinate line${summary.skippedCoordinateLines === 1 ? ' was' : 's were'} skipped because its coordinates could not be parsed.` });
    if (alternateLocationAtoms) warnings.push({ code: 'alternate-locations', severity: 'info', message: `${alternateLocationAtoms} atom record${alternateLocationAtoms === 1 ? ' has' : 's have'} alternate-location identifiers.` });
    if (zeroOccupancyAtoms) warnings.push({ code: 'zero-occupancy', severity: 'info', message: `${zeroOccupancyAtoms} atom record${zeroOccupancyAtoms === 1 ? ' has' : 's have'} zero or missing occupancy.` });
    if (partialOccupancyAtoms) warnings.push({ code: 'partial-occupancy', severity: 'info', message: `${partialOccupancyAtoms} atom record${partialOccupancyAtoms === 1 ? ' has' : 's have'} occupancy between zero and one.` });
    return {
      summary, warnings,
      diagnostics: {
        coordinateLines: summary.coordinateLineCount,
        skippedCoordinateLines: summary.skippedCoordinateLines,
        malformedCoordinateLines: summary.malformedCoordinateLines,
        malformedLineNumbers: Array.isArray(diagnostics.malformedLineNumbers) ? [...diagnostics.malformedLineNumbers] : []
      }
    };
  }

  function residueDescriptor(residueName) {
    const name = String(residueName || 'UNK').trim().toUpperCase() || 'UNK';
    if (AMINO_ACID_CODES[name]) return { symbol: AMINO_ACID_CODES[name], kind: 'protein' };
    if (NUCLEOTIDE_CODES[name]) return { symbol: NUCLEOTIDE_CODES[name], kind: 'nucleic' };
    return { symbol: name.slice(0, 3) || 'UNK', kind: 'other' };
  }

  function buildStructureHierarchy(value) {
    const atoms = Array.isArray(value) ? value : value?.atoms;
    if (!Array.isArray(atoms)) return [];
    const chains = [];
    const chainMap = new Map();
    const residueMaps = new Map();

    for (const atom of atoms) {
      const chainKey = `${atom.model}|${atom.chain}`;
      let chain = chainMap.get(chainKey);
      if (!chain) {
        chain = { key: chainKey, model: atom.model, chain: atom.chain, residues: [] };
        chainMap.set(chainKey, chain);
        residueMaps.set(chainKey, new Map());
        chains.push(chain);
      }

      const residueKey = `${chainKey}|${atom.resi}|${atom.icode}|${atom.resn}`;
      const residues = residueMaps.get(chainKey);
      let residue = residues.get(residueKey);
      if (!residue) {
        const descriptor = residueDescriptor(atom.resn);
        residue = {
          key: residueKey, model: atom.model, chain: atom.chain,
          resn: atom.resn, resi: atom.resi, icode: atom.icode,
          symbol: descriptor.symbol, kind: descriptor.kind, atoms: []
        };
        residues.set(residueKey, residue);
        chain.residues.push(residue);
      }
      residue.atoms.push(atom);
    }
    return chains;
  }

  function representativeAtom(residue) {
    const atoms = residue?.atoms || [];
    const preferred = residue?.kind === 'protein'
      ? ['CA', 'C', 'N']
      : residue?.kind === 'nucleic'
        ? ['P', "C4'", "C1'", 'N1', 'N9']
        : [];
    for (const name of preferred) {
      const primary = atoms.find(atom => atom.name === name && !atom.altLoc);
      if (primary) return primary;
      const alternate = atoms.find(atom => atom.name === name);
      if (alternate) return alternate;
    }
    return atoms.find(atom => atom.element !== 'H' && !atom.altLoc)
      || atoms.find(atom => atom.element !== 'H')
      || atoms[0]
      || null;
  }

  function inferBonds(atoms, bonds) {
    const existing = new Set(bonds.map(([a, b]) => a < b ? `${a}:${b}` : `${b}:${a}`));
    const cellSize = 2.6;
    const cells = new Map();
    const cellKey = (x, y, z) => `${x}|${y}|${z}`;
    for (const atom of atoms) {
      const cell = [Math.floor(atom.x / cellSize), Math.floor(atom.y / cellSize), Math.floor(atom.z / cellSize)];
      atom._cell = cell;
      const key = cellKey(...cell);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(atom.index);
    }
    for (const atom of atoms) {
      const [cx, cy, cz] = atom._cell;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const nearby = cells.get(cellKey(cx + dx, cy + dy, cz + dz));
        if (!nearby) continue;
        for (const otherIndex of nearby) {
          if (otherIndex <= atom.index) continue;
          const other = atoms[otherIndex];
          if (atom.model !== other.model) continue;
          const x = atom.x - other.x, y = atom.y - other.y, z = atom.z - other.z;
          const distance2 = x * x + y * y + z * z;
          const max = (COVALENT_RADII[atom.element] || .77) + (COVALENT_RADII[other.element] || .77) + .46;
          if (distance2 < .16 || distance2 > max * max) continue;
          const key = atom.index < otherIndex ? `${atom.index}:${otherIndex}` : `${otherIndex}:${atom.index}`;
          if (!existing.has(key)) {
            existing.add(key);
            bonds.push([atom.index, otherIndex]);
          }
        }
      }
      delete atom._cell;
    }
  }

  function normalizeDocument(input) {
    if (!input || input.format !== 'molview/document') throw new Error('This is not a molview/document file.');
    const doc = structuredClone(input);
    doc.version = Number(doc.version) || 1;
    doc.documentId ||= uid('document');
    doc.title ||= 'Untitled molecule';
    doc.revision = Number(doc.revision) || 0;
    doc.modified ||= new Date().toISOString();
    doc.modifiedBy ||= 'unknown';
    if (!doc.structure?.data) throw new Error('The document does not contain molecular coordinate data.');
    doc.structure.id ||= uid('structure');
    doc.structure.name ||= 'Molecule';
    doc.structure.format = String(doc.structure.format || 'pdb').toLowerCase();
    if (doc.structure.format !== 'pdb') throw new Error(`Unsupported structure format: ${doc.structure.format}. This version accepts PDB.`);
    doc.structure.metadata = mergeMetadata(parsePDBMetadata(doc.structure.data), doc.structure.metadata);
    doc.scene ||= {};
    Object.assign(doc.scene, {
      representation: doc.scene.representation || 'ball-and-stick',
      colorMode: doc.scene.colorMode || 'element',
      background: doc.scene.background || '#07111f',
      showHydrogens: Boolean(doc.scene.showHydrogens),
      showWater: Boolean(doc.scene.showWater),
      selection: doc.scene.selection || null,
      customColors: Array.isArray(doc.scene.customColors) ? doc.scene.customColors : [],
      measurements: normalizeMeasurements(doc.scene.measurements),
      savedSelections: normalizeSavedSelections(doc.scene.savedSelections),
      ligandAnalysis: normalizeLigandAnalysis(doc.scene.ligandAnalysis, doc.structure.id),
      savedViews: normalizeSavedViews(doc.scene.savedViews),
      camera: normalizeCamera(doc.scene.camera)
    });
    return doc;
  }

  function normalizeMeasurements(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(record => record && typeof record === 'object' && !Array.isArray(record)).map(record => {
      const measurement = { ...record };
      measurement.id = typeof record.id === 'string' && record.id.trim() ? record.id : uid('measurement');
      measurement.type = String(record.type || '').trim().toLowerCase();
      measurement.atoms = Array.isArray(record.atoms)
        ? record.atoms.filter(selector => selector && typeof selector === 'object' && !Array.isArray(selector)).map(selector => ({ ...selector }))
        : [];
      if ('label' in record) measurement.label = String(record.label ?? '');
      if ('note' in record) measurement.note = String(record.note ?? '');
      return measurement;
    });
  }

  function normalizeSavedSelections(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(record => record && typeof record === 'object' && !Array.isArray(record)).map((record, index) => {
      const saved = { ...record };
      saved.id = typeof record.id === 'string' && record.id.trim() ? record.id : uid('selection');
      saved.name = typeof record.name === 'string' && record.name.trim()
        ? record.name.trim().slice(0, 80)
        : `Saved selection ${index + 1}`;
      saved.selector = normalizeCompoundSelector(record.selector);
      return saved;
    });
  }

  function normalizeCompoundSelector(value, depth = 0) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const selector = { ...value };
    selector.kind = String(value.kind || '').trim().toLowerCase();
    for (const key of ['structureId', 'chain', 'icode', 'resn', 'atom', 'altLoc']) {
      if (key in value && value[key] != null) selector[key] = String(value[key]);
    }
    for (const key of ['model', 'resi', 'serial', 'cutoff']) {
      if (!(key in value)) continue;
      const number = Number(value[key]);
      selector[key] = Number.isFinite(number) ? number : value[key];
    }
    for (const key of ['start', 'end']) {
      if (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key])) continue;
      selector[key] = { ...value[key] };
      const resi = Number(value[key].resi);
      if (Number.isFinite(resi)) selector[key].resi = resi;
      if ('icode' in value[key] && value[key].icode != null) selector[key].icode = String(value[key].icode);
    }
    if (depth < 2 && value.target && typeof value.target === 'object' && !Array.isArray(value.target)) {
      selector.target = normalizeCompoundSelector(value.target, depth + 1);
    }
    return selector;
  }

  function matchSavedSelection(value, atoms, structureId) {
    const selector = value?.selector && typeof value.selector === 'object' ? value.selector : value;
    const candidates = Array.isArray(atoms) ? atoms : [];
    if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
      return selectionMatchError('Selector must be an object.');
    }
    if (!selector.structureId) return selectionMatchError('Selector is missing structureId.');
    if (selector.structureId !== structureId) {
      return selectionMatchError('Selector belongs to a different structure.');
    }

    const kind = String(selector.kind || '').toLowerCase();
    let matched;
    if (kind === 'atom') {
      if (!validRequiredSelectorFields(selector, ['model', 'chain', 'resi', 'atom'])) {
        return selectionMatchError('Atom selector is missing model, chain, residue, or atom name.');
      }
      matched = candidates.filter(atom => atomMatchesSelector(atom, selector, structureId));
    } else if (kind === 'residue') {
      if (!validRequiredSelectorFields(selector, ['model', 'chain', 'resi'])) {
        return selectionMatchError('Residue selector is missing model, chain, or residue number.');
      }
      matched = candidates.filter(atom =>
        atom.model === Number(selector.model) && atom.chain === selector.chain
        && atom.resi === Number(selector.resi)
        && (selector.icode == null || atom.icode === selector.icode)
        && (selector.resn == null || atom.resn === selector.resn)
      );
    } else if (kind === 'chain') {
      if (!validRequiredSelectorFields(selector, ['model', 'chain'])) {
        return selectionMatchError('Chain selector is missing model or chain.');
      }
      matched = candidates.filter(atom => atom.model === Number(selector.model) && atom.chain === selector.chain);
    } else if (kind === 'residue-range') {
      const start = Number(selector.start?.resi);
      const end = Number(selector.end?.resi);
      if (!validRequiredSelectorFields(selector, ['model', 'chain']) || !Number.isFinite(start) || !Number.isFinite(end)) {
        return selectionMatchError('Residue range needs a model, chain, start, and end.');
      }
      if (start > end) return selectionMatchError('Residue range start must not exceed its end.');
      matched = candidates.filter(atom =>
        atom.model === Number(selector.model) && atom.chain === selector.chain
        && atom.resi >= start && atom.resi <= end
        && (atom.resi !== start || selector.start.icode == null || atom.icode >= selector.start.icode)
        && (atom.resi !== end || selector.end.icode == null || atom.icode <= selector.end.icode)
      );
    } else if (kind === 'ligands') {
      if (selector.model != null && !Number.isFinite(Number(selector.model))) {
        return selectionMatchError('Ligand selector model must be a number.');
      }
      matched = candidates.filter(atom =>
        atom.het && !isWater(atom)
        && (selector.model == null || atom.model === Number(selector.model))
      );
    } else if (kind === 'within') {
      const cutoff = Number(selector.cutoff);
      if (!Number.isFinite(cutoff) || cutoff <= 0 || cutoff > 100) {
        return selectionMatchError('Proximity cutoff must be greater than 0 and at most 100 Å.');
      }
      const targetKind = String(selector.target?.kind || '').toLowerCase();
      if (!['atom', 'residue', 'ligands'].includes(targetKind)) {
        return selectionMatchError('Proximity target must be an atom, residue, or ligand selector.');
      }
      const target = matchSavedSelection(selector.target, candidates, structureId);
      if (!target.valid) return selectionMatchError(`Invalid proximity target: ${target.error}`);
      matched = atomsWithin(candidates, target.atoms, cutoff);
    } else {
      return selectionMatchError(`Unsupported selector kind: ${kind || '(missing)'}.`);
    }

    return {
      valid: true,
      error: null,
      atoms: matched,
      atomCount: matched.length,
      residueCount: countMatchedResidues(matched)
    };
  }

  function validRequiredSelectorFields(selector, keys) {
    return keys.every(key => {
      if (selector[key] == null || selector[key] === '') return false;
      if (key === 'model' || key === 'resi') return Number.isFinite(Number(selector[key]));
      return true;
    });
  }

  function selectionMatchError(error) {
    return { valid: false, error, atoms: [], atomCount: 0, residueCount: 0 };
  }

  function countMatchedResidues(atoms) {
    return new Set(atoms.map(atom => `${atom.model}|${atom.chain}|${atom.resi}|${atom.icode}|${atom.resn}`)).size;
  }

  function atomsWithin(atoms, targets, cutoff) {
    if (!targets.length) return [];
    const cellSize = cutoff;
    const cells = new Map();
    const keyFor = (atom, x, y, z) => `${atom.model}|${x}|${y}|${z}`;
    for (const atom of targets) {
      const cell = [Math.floor(atom.x / cellSize), Math.floor(atom.y / cellSize), Math.floor(atom.z / cellSize)];
      const key = keyFor(atom, ...cell);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(atom);
    }
    const cutoff2 = cutoff * cutoff;
    return atoms.filter(atom => {
      const [cx, cy, cz] = [Math.floor(atom.x / cellSize), Math.floor(atom.y / cellSize), Math.floor(atom.z / cellSize)];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const nearby = cells.get(keyFor(atom, cx + dx, cy + dy, cz + dz));
        if (!nearby) continue;
        for (const target of nearby) {
          const x = atom.x - target.x, y = atom.y - target.y, z = atom.z - target.z;
          if (x * x + y * y + z * z <= cutoff2) return true;
        }
      }
      return false;
    });
  }

  function describeSavedSelector(selector) {
    const kind = String(selector?.kind || '').toLowerCase();
    const chain = selector?.chain === '_' ? 'no chain' : `chain ${selector?.chain}`;
    if (kind === 'atom') return `${selector.resn || 'Residue'} ${selector.resi}${selector.icode || ''} · ${selector.atom} · ${chain}`;
    if (kind === 'residue') return `${selector.resn || 'Residue'} ${selector.resi}${selector.icode || ''} · ${chain}`;
    if (kind === 'chain') return `${chain} · model ${selector.model}`;
    if (kind === 'residue-range') return `${chain} · residues ${selector.start?.resi ?? '?'}–${selector.end?.resi ?? '?'}`;
    if (kind === 'ligands') return selector.model == null ? 'All non-water ligands' : `Non-water ligands · model ${selector.model}`;
    if (kind === 'within') return `Within ${selector.cutoff ?? '?'} Å of ${describeSavedSelector(selector.target)}`;
    return 'Invalid or unsupported selector';
  }

  function normalizeLigandAnalysis(value, structureId) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const analysis = { ...source };
    const selected = source.selectedLigand;
    analysis.selectedLigand = selected && typeof selected === 'object' && !Array.isArray(selected)
      && (!selected.structureId || selected.structureId === structureId)
      ? { ...selected, structureId }
      : null;
    analysis.cutoff = clamp(Number(source.cutoff) || LIGAND_ANALYSIS_DEFAULTS.cutoff, 2.5, 8);
    for (const key of ['showLigand', 'showPocket', 'showContacts', 'polarOnly']) {
      analysis[key] = key in source ? Boolean(source[key]) : LIGAND_ANALYSIS_DEFAULTS[key];
    }
    return analysis;
  }

  function ligandSelector(atom, structureId) {
    return {
      structureId, model: atom.model, chain: atom.chain, resi: atom.resi,
      icode: atom.icode, resn: atom.resn
    };
  }

  function ligandKey(selector) {
    if (!selector) return '';
    return `${selector.structureId || ''}|${Number(selector.model) || 1}|${selector.chain || '_'}|${Number(selector.resi) || 0}|${selector.icode || ''}|${selector.resn || 'UNK'}`;
  }

  function groupLigands(value, structureId = '') {
    const atoms = Array.isArray(value) ? value : value?.atoms;
    if (!Array.isArray(atoms)) return [];
    const ligands = [];
    const byKey = new Map();
    for (const atom of atoms) {
      if (!atom.het || isWater(atom)) continue;
      const selector = ligandSelector(atom, structureId);
      const key = ligandKey(selector);
      let ligand = byKey.get(key);
      if (!ligand) {
        ligand = {
          key, selector, model: atom.model, chain: atom.chain, resi: atom.resi,
          icode: atom.icode, resn: atom.resn, label: ligandLabel(selector), atoms: []
        };
        byKey.set(key, ligand);
        ligands.push(ligand);
      }
      ligand.atoms.push(atom);
    }
    for (const ligand of ligands) {
      ligand.atomCount = ligand.atoms.length;
      ligand.heavyAtomCount = ligand.atoms.filter(atom => atom.element !== 'H').length;
    }
    return ligands;
  }

  function ligandLabel(selector) {
    const chain = selector.chain === '_' ? 'no chain' : `chain ${selector.chain}`;
    return `${selector.resn || 'UNK'} ${Number(selector.resi) || 0}${selector.icode || ''} · ${chain}${Number(selector.model) > 1 ? ` · model ${selector.model}` : ''}`;
  }

  function findLigand(ligands, selector, structureId) {
    if (!selector) return null;
    if (selector.structureId && selector.structureId !== structureId) return null;
    return ligands.find(ligand => ligand.selector.model === Number(selector.model)
      && ligand.selector.chain === selector.chain
      && ligand.selector.resi === Number(selector.resi)
      && ligand.selector.icode === (selector.icode || '')
      && ligand.selector.resn === selector.resn) || null;
  }

  function analyzeLigandPocket(value, selectedLigand, cutoffValue = LIGAND_ANALYSIS_DEFAULTS.cutoff, structureId = '') {
    const atoms = Array.isArray(value) ? value : value?.atoms;
    const cutoff = clamp(Number(cutoffValue) || LIGAND_ANALYSIS_DEFAULTS.cutoff, 2.5, 8);
    const ligands = groupLigands(atoms, structureId);
    const ligand = findLigand(ligands, selectedLigand, structureId);
    const empty = { cutoff, ligand, residues: [], contacts: [], candidatePairs: 0, indexedAtomCount: 0 };
    if (!ligand || !Array.isArray(atoms)) return empty;

    const eligible = atoms.filter(atom => atom.model === ligand.model && !atom.het && atom.element !== 'H'
      && ['protein', 'nucleic'].includes(residueDescriptor(atom.resn).kind));
    const cellSize = cutoff;
    const cells = new Map();
    const cellKey = (x, y, z) => `${x}|${y}|${z}`;
    for (const atom of eligible) {
      const cell = [Math.floor(atom.x / cellSize), Math.floor(atom.y / cellSize), Math.floor(atom.z / cellSize)];
      const key = cellKey(...cell);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(atom);
    }

    const contacts = [];
    const seen = new Set();
    let candidatePairs = 0;
    for (const ligandAtom of ligand.atoms.filter(atom => atom.element !== 'H')) {
      const cx = Math.floor(ligandAtom.x / cellSize);
      const cy = Math.floor(ligandAtom.y / cellSize);
      const cz = Math.floor(ligandAtom.z / cellSize);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const nearby = cells.get(cellKey(cx + dx, cy + dy, cz + dz));
        if (!nearby) continue;
        for (const targetAtom of nearby) {
          candidatePairs += 1;
          const pairKey = `${ligandAtom.index}:${targetAtom.index}`;
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);
          const distance = magnitude(subtract(ligandAtom, targetAtom));
          if (distance > cutoff || distance < .1) continue;
          const vdwLimit = vdwRadius(ligandAtom.element) + vdwRadius(targetAtom.element) + .5;
          const close = distance <= Math.min(cutoff, vdwLimit);
          const polar = distance <= Math.min(cutoff, 3.5)
            && POLAR_ELEMENTS.has(ligandAtom.element) && POLAR_ELEMENTS.has(targetAtom.element);
          contacts.push({
            ligandAtom, targetAtom, distance, close, polar,
            classification: polar ? 'polar' : close ? 'close' : 'nearby'
          });
        }
      }
    }
    contacts.sort((left, right) => left.distance - right.distance);

    const residueMap = new Map();
    for (const contact of contacts) {
      const atom = contact.targetAtom;
      const key = `${atom.model}|${atom.chain}|${atom.resi}|${atom.icode}|${atom.resn}`;
      let residue = residueMap.get(key);
      if (!residue) {
        const descriptor = residueDescriptor(atom.resn);
        residue = {
          key, model: atom.model, chain: atom.chain, resi: atom.resi, icode: atom.icode,
          resn: atom.resn, kind: descriptor.kind, atoms: [], contacts: [],
          minimumDistance: contact.distance, hasClose: false, hasPolar: false
        };
        residueMap.set(key, residue);
      }
      if (!residue.atoms.some(candidate => candidate.index === atom.index)) residue.atoms.push(atom);
      residue.contacts.push(contact);
      residue.minimumDistance = Math.min(residue.minimumDistance, contact.distance);
      residue.hasClose ||= contact.close;
      residue.hasPolar ||= contact.polar;
    }
    const residues = [...residueMap.values()].sort((left, right) => left.minimumDistance - right.minimumDistance);
    return { cutoff, ligand, residues, contacts, candidatePairs, indexedAtomCount: eligible.length };
  }

  function validCamera(camera) {
    return Array.isArray(camera?.view) && camera.view.length === 8 && camera.view.every(Number.isFinite);
  }

  function normalizeCamera(camera) {
    if (!camera || typeof camera !== 'object' || Array.isArray(camera)) return { view: null };
    return { ...camera, view: validCamera(camera) ? camera.view.map(Number) : null };
  }

  function normalizeSavedViewSnapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { camera: { view: null } };
    const snapshot = structuredClone(value);
    snapshot.camera = normalizeCamera(value.camera);
    if ('representation' in snapshot && !REPRESENTATIONS.has(snapshot.representation)) delete snapshot.representation;
    if ('colorMode' in snapshot && !COLOR_MODES.has(snapshot.colorMode)) delete snapshot.colorMode;
    if ('background' in snapshot) snapshot.background = String(snapshot.background || '#07111f');
    if ('showHydrogens' in snapshot) snapshot.showHydrogens = Boolean(snapshot.showHydrogens);
    if ('showWater' in snapshot) snapshot.showWater = Boolean(snapshot.showWater);
    if ('selection' in snapshot) snapshot.selection = snapshot.selection && typeof snapshot.selection === 'object'
      ? structuredClone(snapshot.selection) : null;
    if ('customColors' in snapshot) snapshot.customColors = Array.isArray(snapshot.customColors)
      ? structuredClone(snapshot.customColors) : [];
    delete snapshot.savedViews;
    return snapshot;
  }

  function normalizeSavedViews(value) {
    if (!Array.isArray(value)) return [];
    const usedIds = new Set();
    return value
      .filter(record => record && typeof record === 'object' && !Array.isArray(record))
      .map((record, index) => {
        const view = structuredClone(record);
        const proposedId = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : uid('view');
        view.id = usedIds.has(proposedId) ? uid('view') : proposedId;
        usedIds.add(view.id);
        view.title = String(record.title || '').trim();
        if ('narrative' in record || 'note' in record) {
          view.narrative = String(record.narrative ?? record.note ?? '');
        }
        view.order = Number.isFinite(Number(record.order)) ? Number(record.order) : index;
        view.snapshot = normalizeSavedViewSnapshot(record.snapshot);
        return view;
      })
      .sort((left, right) => left.order - right.order)
      .map((view, order) => ({ ...view, title: view.title || `View ${order + 1}`, order }));
  }

  function captureSavedViewSnapshot(scene, options = {}) {
    const snapshot = {};
    for (const field of SAVED_VIEW_SCENE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(scene || {}, field)) snapshot[field] = structuredClone(scene[field]);
    }
    snapshot.camera = normalizeCamera(options.camera || scene?.camera);
    if (Object.prototype.hasOwnProperty.call(options, 'activeAnalysis')) {
      snapshot.activeAnalysis = structuredClone(options.activeAnalysis);
    }
    delete snapshot.savedViews;
    return snapshot;
  }

  function applySavedViewSnapshot(scene, value) {
    const snapshot = normalizeSavedViewSnapshot(value);
    const next = structuredClone(scene || {});
    for (const field of SAVED_VIEW_SCENE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(snapshot, field)) next[field] = structuredClone(snapshot[field]);
    }
    if (Object.prototype.hasOwnProperty.call(snapshot, 'camera')) next.camera = normalizeCamera(snapshot.camera);
    return next;
  }

  function reorderSavedViews(value, id, offset) {
    const views = normalizeSavedViews(value);
    const index = views.findIndex(view => view.id === id);
    if (index < 0) return views;
    const target = Math.max(0, Math.min(views.length - 1, index + Number(offset || 0)));
    if (target !== index) {
      const [view] = views.splice(index, 1);
      views.splice(target, 0, view);
    }
    return views.map((view, order) => ({ ...view, order }));
  }

  function selectorForAtom(atom, scope, structureId) {
    const base = { structureId, model: atom.model };
    if (scope === 'chain') return { ...base, chain: atom.chain };
    if (scope === 'residue') return { ...base, chain: atom.chain, resi: atom.resi, icode: atom.icode, resn: atom.resn };
    return { ...base, chain: atom.chain, resi: atom.resi, icode: atom.icode, atom: atom.name, altLoc: atom.altLoc, serial: atom.serial };
  }

  function atomMatchesSelector(atom, selector, structureId) {
    if (!selector) return false;
    if (selector.structureId && selector.structureId !== structureId) return false;
    if (selector.model != null && Number(selector.model) !== atom.model) return false;
    if (selector.chain != null && selector.chain !== atom.chain) return false;
    if (selector.resi != null && Number(selector.resi) !== atom.resi) return false;
    if (selector.icode != null && selector.icode !== atom.icode) return false;
    if (selector.resn != null && selector.resn !== atom.resn) return false;
    if (selector.atom != null && selector.atom !== atom.name) return false;
    if (selector.altLoc != null && selector.altLoc !== atom.altLoc) return false;
    if (selector.serial != null && Number(selector.serial) !== atom.serial) return false;
    return true;
  }

  function atomIdentity(atom, structureId) {
    return {
      kind: 'atom', structureId, model: atom.model, chain: atom.chain,
      residueName: atom.resn, residueNumber: atom.resi, insertionCode: atom.icode,
      atomName: atom.name, alternateLocation: atom.altLoc, serial: atom.serial,
      element: atom.element
    };
  }

  function measurementAtoms(measurement, atoms, structureId) {
    const expected = MEASUREMENT_ATOM_COUNTS[measurement?.type];
    if (!expected || !Array.isArray(measurement.atoms) || measurement.atoms.length !== expected) return null;
    const resolved = measurement.atoms.map(selector => atoms.find(atom => atomMatchesSelector(atom, selector, structureId)));
    return resolved.every(Boolean) ? resolved : null;
  }

  function measurementValue(type, atoms) {
    const expected = MEASUREMENT_ATOM_COUNTS[type];
    if (!expected || !Array.isArray(atoms) || atoms.length !== expected) return NaN;
    if (type === 'distance') return magnitude(subtract(atoms[1], atoms[0]));
    if (type === 'angle') {
      const left = subtract(atoms[0], atoms[1]);
      const right = subtract(atoms[2], atoms[1]);
      const denominator = magnitude(left) * magnitude(right);
      if (denominator < 1e-12) return NaN;
      return Math.acos(clamp(dot(left, right) / denominator, -1, 1)) * 180 / Math.PI;
    }
    if (type === 'dihedral') {
      const b0 = subtract(atoms[0], atoms[1]);
      const b1 = subtract(atoms[2], atoms[1]);
      const b2 = subtract(atoms[3], atoms[2]);
      const b1Length = magnitude(b1);
      if (b1Length < 1e-12) return NaN;
      const axis = scale(b1, 1 / b1Length);
      const v = subtract(b0, scale(axis, dot(b0, axis)));
      const w = subtract(b2, scale(axis, dot(b2, axis)));
      if (magnitude(v) < 1e-12 || magnitude(w) < 1e-12) return NaN;
      return Math.atan2(dot(cross(axis, v), w), dot(v, w)) * 180 / Math.PI;
    }
    return NaN;
  }

  function formatMeasurementValue(type, value) {
    if (!Number.isFinite(value)) return 'Unavailable';
    return type === 'distance' ? `${value.toFixed(2)} Å` : `${value.toFixed(1)}°`;
  }

  function subtract(a, b) { return { x: Number(a.x) - Number(b.x), y: Number(a.y) - Number(b.y), z: Number(a.z) - Number(b.z) }; }
  function scale(a, amount) { return { x: a.x * amount, y: a.y * amount, z: a.z * amount }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
  function magnitude(a) { return Math.hypot(a.x, a.y, a.z); }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function atomLabel(atom) {
    const chain = atom.chain === '_' ? 'no chain' : `chain ${atom.chain}`;
    return `${atom.resn} ${atom.resi}${atom.icode || ''} · ${atom.name} · ${chain}`;
  }

  function chainColor(chain, chains) {
    const index = Math.max(0, chains.indexOf(chain));
    return CHAIN_COLORS[index % CHAIN_COLORS.length];
  }

  function colorForAtom(atom, doc, parsed) {
    const rules = doc.scene.customColors || [];
    for (let i = rules.length - 1; i >= 0; i--) {
      if (atomMatchesSelector(atom, rules[i].selector, doc.structure.id)) return rules[i].color;
    }
    if (doc.scene.colorMode === 'chain') return chainColor(atom.chain, parsed.chains);
    if (doc.scene.colorMode === 'residue') {
      const residueIndex = Math.abs((atom.resi * 31 + atom.chain.charCodeAt(0)) | 0);
      return CHAIN_COLORS[residueIndex % CHAIN_COLORS.length];
    }
    if (doc.scene.colorMode === 'uniform') return '#7db7ff';
    return ELEMENT_COLORS[atom.element] || '#d5d9e0';
  }

  function isWater(atom) { return WATER_NAMES.has(atom.resn); }
  function vdwRadius(element) { return VDW_RADII[element] || 1.7; }

  window.MolViewCore = {
    ELEMENT_COLORS, CHAIN_COLORS, parsePDB, parsePDBMetadata, normalizeMetadata, mergeMetadata,
    metadataFromRCSBEntry, deriveDataQuality, normalizeDocument, selectorForAtom,
    atomMatchesSelector, atomIdentity, atomLabel, colorForAtom, isWater, vdwRadius, uid,
    MEASUREMENT_ATOM_COUNTS, normalizeMeasurements, measurementAtoms, measurementValue,
    formatMeasurementValue,
    normalizeSavedSelections, normalizeCompoundSelector, matchSavedSelection, describeSavedSelector,
    residueDescriptor, buildStructureHierarchy, representativeAtom,
    LIGAND_ANALYSIS_DEFAULTS, normalizeLigandAnalysis, ligandSelector, ligandKey, ligandLabel,
    groupLigands, findLigand, analyzeLigandPocket,
    SAVED_VIEW_SCENE_FIELDS, normalizeSavedViews, normalizeSavedViewSnapshot,
    captureSavedViewSnapshot, applySavedViewSnapshot, reorderSavedViews, validCamera
  };
})();
