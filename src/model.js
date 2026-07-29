(function () {
  'use strict';

  const Structure = window.MolhtmlStructure;

  const ELEMENT_COLORS = {
    H: '#f4f7fb', C: '#8492a6', N: '#4f7cff', O: '#ff4d5e', F: '#56d68b',
    P: '#ff9f43', S: '#ffd43b', CL: '#38d47a', BR: '#a85c3f', I: '#7b3fa1',
    FE: '#d17835', MG: '#31c48d', ZN: '#8b95a5', CA: '#5fd3bc'
  };
  const CHAIN_COLORS = ['#54a7ff', '#ff6b8a', '#63d7a5', '#ffc857', '#a98bff', '#44d6e8', '#ff9364'];
  const VDW_RADII = { H: 1.2, C: 1.7, N: 1.55, O: 1.52, F: 1.47, P: 1.8, S: 1.8, CL: 1.75, BR: 1.85, I: 1.98, FE: 1.8, MG: 1.73, ZN: 1.39, CA: 2.31 };
  const WATER_NAMES = new Set(['HOH', 'WAT', 'H2O', 'DOD']);
  const POLAR_ELEMENTS = new Set(['N', 'O', 'S']);
  const LIGAND_ANALYSIS_DEFAULTS = Object.freeze({
    cutoff: 4, showLigand: true, showPocket: true, showContacts: true, polarOnly: false
  });
  const INTERACTION_DEFAULTS = Object.freeze({
    enabled: false,
    types: Object.freeze({ hydrogenBonds: true, saltBridges: true }),
    includeWater: false
  });
  const INTERACTION_CLASSIFIER_VERSION = 'mvp-1';
  const INTERACTION_PARTITION_LIMIT = 500;
  const INTERACTION_RENDER_LIMIT = 500;
  const INTERACTION_CANDIDATE_WORK_LIMIT = 10_000_000;
  const INTERACTION_SALT_SITE_PAIR_LIMIT = 10_000;
  const interactionAnalysisCache = new WeakMap();
  const MEASUREMENT_ATOM_COUNTS = Object.freeze({ distance: 2, angle: 3, dihedral: 4 });
  const REPRESENTATIONS = new Set(['cartoon', 'ball-and-stick', 'sticks', 'spacefill', 'lines', 'surface']);
  const COLOR_MODES = new Set(['element', 'chain', 'author-chain', 'instance', 'entity', 'role', 'residue', 'uniform']);
  const DOCUMENT_V2_COLOR_MODES = new Set(['author-chain', 'instance', 'entity', 'role']);
  const DOCUMENT_V2_SELECTOR_KINDS = new Set(['instance', 'entity', 'role', 'connected-component']);
  const ROLE_COLORS = Object.freeze({
    polymer: '#54a7ff', ligand: '#ff6b8a', ion: '#ffc857', solvent: '#7c91a7', unknown: '#a98bff'
  });
  const SAVED_VIEW_SCENE_FIELDS = Object.freeze([
    'representation', 'colorMode', 'background', 'showHydrogens', 'showWater',
    'interactions',
    'selection', 'customColors', 'activeAnalysis', 'analysisHighlight',
    'highlight', 'highlights', 'activeHighlight', 'activeLigandId', 'ligandHighlight'
  ]);
  const resolvedSelectorIndexCache = new WeakMap();
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

  function requireStructureLayer() {
    if (!Structure?.parseStructure) throw new Error('The molecular structure layer did not load.');
    return Structure;
  }

  function parsePDB(text) {
    const parsed = requireStructureLayer().parseStructure(text, 'pdb');
    parsed.metadata = parsePDBMetadata(text);
    return parsed;
  }

  function parseStructure(data, formatHint = '') {
    const layer = requireStructureLayer();
    const format = layer.detectStructureFormat(data, formatHint);
    const parsed = layer.parseStructure(data, format);
    parsed.metadata = format === 'mmcif' ? parseMmcifMetadata(parsed) : parsePDBMetadata(data);
    return parsed;
  }

  function parseMmcifMetadata(value) {
    const parsed = value?.cifCategories
      ? value
      : requireStructureLayer().parseStructure(value, 'mmcif');
    const categories = parsed.cifCategories || {};
    const first = name => categories[name]?.[0] || {};
    const clean = input => input == null || input === '.' || input === '?' ? '' : String(input).trim();
    const values = (name, field) => compactStrings((categories[name] || []).map(row => clean(row[field])));
    const struct = first('struct');
    const keywords = first('struct_keywords');
    const entry = first('entry');
    const databaseRows = categories.database_2 || [];
    const pdbDatabase = databaseRows.find(row => /pdb/i.test(clean(row.database_id))) || {};
    const refineResolution = (categories.refine || []).map(row => Number(row.ls_d_res_high)).filter(Number.isFinite);
    const emResolution = (categories.em_3d_reconstruction || []).map(row => Number(row.resolution)).filter(Number.isFinite);
    const citationRows = categories.citation || [];
    const citation = citationRows.find(row => clean(row.id).toLowerCase() === 'primary') || citationRows[0];
    const citationAuthors = (categories.citation_author || [])
      .filter(row => !citation || clean(row.citation_id) === clean(citation.id))
      .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
      .map(row => clean(row.name)).filter(Boolean);
    const metadata = {
      title: clean(struct.title),
      classification: clean(keywords.pdbx_keywords) || clean(keywords.text),
      pdbId: (clean(pdbDatabase.database_code) || clean(entry.id)).toUpperCase(),
      depositionDate: clean(first('pdbx_database_status').recvd_initial_deposition_date),
      releaseDate: clean(first('pdbx_audit_revision_history').revision_date),
      organisms: compactStrings([
        ...values('entity_src_gen', 'pdbx_gene_src_scientific_name'),
        ...values('entity_src_nat', 'pdbx_organism_scientific'),
        ...values('pdbx_entity_src_syn', 'organism_scientific')
      ]),
      experimentalMethods: values('exptl', 'method'),
      resolutionAngstroms: [...new Set([...refineResolution, ...emResolution])],
      authors: values('audit_author', 'name'),
      entityDescriptions: values('entity', 'pdbx_description'),
      provenance: { kind: 'embedded-mmcif' }
    };
    if (citation) {
      const primaryCitation = {
        title: clean(citation.title),
        authors: citationAuthors,
        journal: clean(citation.journal_abbrev),
        doi: clean(citation.pdbx_database_id_doi),
        pubmedId: clean(citation.pdbx_database_id_pubmed)
      };
      const year = Number(citation.year);
      if (Number.isFinite(year)) primaryCitation.year = year;
      metadata.primaryCitation = primaryCitation;
    }
    const identifiers = {};
    if (metadata.pdbId) identifiers.pdbId = metadata.pdbId;
    if (metadata.primaryCitation?.doi) identifiers.doi = metadata.primaryCitation.doi;
    if (metadata.primaryCitation?.pubmedId) identifiers.pubmedId = metadata.primaryCitation.pubmedId;
    if (Object.keys(identifiers).length) metadata.identifiers = identifiers;
    return normalizeMetadata(metadata);
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
      else if (isLigandLike(atom)) ligands.add(residueKey);
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

  function normalizeDocument(input) {
    if (!input || input.format !== 'molhtml/document') throw new Error('This is not a molhtml/document file.');
    const doc = structuredClone(input);
    doc.version = Number(doc.version) || 1;
    if (![1, 2].includes(doc.version)) throw new Error(`Unsupported mol.html document version: ${doc.version}.`);
    doc.documentId ||= uid('document');
    doc.title ||= 'Untitled molecule';
    doc.revision = Number(doc.revision) || 0;
    doc.modified ||= new Date().toISOString();
    doc.modifiedBy ||= 'unknown';
    if (!doc.structure?.data) throw new Error('The document does not contain molecular coordinate data.');
    doc.structure.id ||= uid('structure');
    doc.structure.name ||= 'Molecule';
    doc.structure.format = requireStructureLayer().detectStructureFormat(doc.structure.data, doc.structure.format || '');
    const sourceMetadata = doc.structure.format === 'mmcif'
      ? parseMmcifMetadata(doc.structure.data)
      : parsePDBMetadata(doc.structure.data);
    doc.structure.metadata = mergeMetadata(sourceMetadata, doc.structure.metadata);
    doc.scene ||= {};
    if (doc.version === 1) migrateV1StructureBindings(doc.scene, doc.structure.id);
    Object.assign(doc.scene, {
      representation: REPRESENTATIONS.has(doc.scene.representation) ? doc.scene.representation : 'ball-and-stick',
      colorMode: COLOR_MODES.has(doc.scene.colorMode) ? doc.scene.colorMode : 'element',
      background: doc.scene.background || '#07111f',
      showHydrogens: Boolean(doc.scene.showHydrogens),
      showWater: Boolean(doc.scene.showWater),
      selection: doc.scene.selection || null,
      customColors: Array.isArray(doc.scene.customColors) ? doc.scene.customColors : [],
      measurements: normalizeMeasurements(doc.scene.measurements),
      savedSelections: normalizeSavedSelections(doc.scene.savedSelections),
      ligandAnalysis: normalizeLigandAnalysis(doc.scene.ligandAnalysis, doc.structure.id),
      interactions: normalizeInteractions(doc.scene.interactions),
      savedViews: normalizeSavedViews(doc.scene.savedViews),
      camera: normalizeCamera(doc.scene.camera)
    });
    if (requiresDocumentV2(doc)) doc.version = 2;
    return doc;
  }

  function migrateV1StructureBindings(scene, structureId) {
    const bindSelector = selector => {
      if (!selector || typeof selector !== 'object' || Array.isArray(selector)) return;
      selector.structureId ||= structureId;
      bindSelector(selector.target);
    };
    bindSelector(scene.selection?.selector);
    for (const rule of Array.isArray(scene.customColors) ? scene.customColors : []) bindSelector(rule?.selector);
    for (const measurement of Array.isArray(scene.measurements) ? scene.measurements : []) {
      for (const selector of Array.isArray(measurement?.atoms) ? measurement.atoms : []) bindSelector(selector);
    }
    for (const saved of Array.isArray(scene.savedSelections) ? scene.savedSelections : []) bindSelector(saved?.selector);
    bindSelector(scene.ligandAnalysis?.selectedLigand);
    for (const view of Array.isArray(scene.savedViews) ? scene.savedViews : []) {
      if (view && typeof view === 'object' && !Array.isArray(view)) view.structureId ||= structureId;
      bindSelector(view?.snapshot?.selection?.selector);
      for (const rule of Array.isArray(view?.snapshot?.customColors) ? view.snapshot.customColors : []) bindSelector(rule?.selector);
    }
  }

  function applyDocumentCommand(doc, value) {
    if (!doc || typeof doc !== 'object') throw new Error('A command requires a document.');
    const command = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const type = String(command.type || '').trim().toLowerCase();
    if (type === 'set-scene-field') {
      const field = String(command.field || '');
      if (!['representation', 'colorMode', 'background', 'showHydrogens', 'showWater'].includes(field)) {
        throw new Error(`Unsupported scene field: ${field || '(missing)'}.`);
      }
      if (field === 'representation' && !REPRESENTATIONS.has(command.value)) throw new Error(`Unsupported representation: ${command.value}.`);
      if (field === 'colorMode' && !COLOR_MODES.has(command.value)) throw new Error(`Unsupported color mode: ${command.value}.`);
      if (field === 'background' && !/^#[0-9a-f]{6}$/i.test(command.value || '')) throw new Error('Background must be a six-digit hex color.');
      doc.scene[field] = field === 'showHydrogens' || field === 'showWater' ? Boolean(command.value) : command.value;
    } else if (type === 'set-selection') {
      doc.scene.selection = command.selection == null ? null : structuredClone(command.selection);
    } else if (type === 'add-custom-color') {
      if (!command.rule || typeof command.rule !== 'object' || Array.isArray(command.rule)) throw new Error('A custom-color command requires a rule.');
      if (!/^#[0-9a-f]{6}$/i.test(command.rule.color || '')) throw new Error('Custom color must be a six-digit hex color.');
      doc.scene.customColors.push(structuredClone(command.rule));
    } else if (type === 'set-measurements') {
      doc.scene.measurements = normalizeMeasurements(command.measurements);
    } else if (type === 'set-saved-selections') {
      doc.scene.savedSelections = normalizeSavedSelections(command.savedSelections);
    } else if (type === 'set-ligand-analysis') {
      doc.scene.ligandAnalysis = normalizeLigandAnalysis(command.ligandAnalysis, doc.structure.id, true);
    } else if (type === 'set-interactions') {
      doc.scene.interactions = normalizeInteractions(command.interactions);
    } else if (type === 'set-saved-views') {
      doc.scene.savedViews = normalizeSavedViews(command.savedViews);
    } else if (type === 'set-camera') {
      doc.scene.camera = normalizeCamera(command.camera);
    } else if (type === 'apply-saved-view') {
      doc.scene = applySavedViewSnapshot(doc.scene, command.snapshot);
    } else if (type === 'reset-appearance') {
      Object.assign(doc.scene, {
        representation: 'ball-and-stick', colorMode: 'element', background: '#07111f',
        showHydrogens: false, showWater: false, customColors: [],
        interactions: normalizeInteractions(null)
      });
    } else if (type === 'replace-structure') {
      if (!command.structure?.data) throw new Error('A replacement structure requires coordinate data.');
      doc.title = String(command.title || command.structure.name || 'Molecule');
      doc.structure = structuredClone(command.structure);
      Object.assign(doc.scene, {
        selection: null,
        customColors: [],
        measurements: [],
        savedSelections: [],
        ligandAnalysis: normalizeLigandAnalysis(null, doc.structure.id),
        savedViews: [],
        camera: { view: null }
      });
    } else {
      throw new Error(`Unsupported document command: ${type || '(missing)'}.`);
    }
    if (requiresDocumentV2(doc)) doc.version = 2;
    return doc;
  }

  function selectorRequiresDocumentV2(value) {
    const pending = [value];
    while (pending.length) {
      const candidate = pending.pop();
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      if (candidate.sourceIdentity != null
        || candidate.instanceId != null
        || candidate.entityId != null
        || candidate.role != null
        || candidate.connectedComponentId != null
        || DOCUMENT_V2_SELECTOR_KINDS.has(candidate.kind || candidate.scope)) {
        return true;
      }
      pending.push(candidate.selector, candidate.target);
    }
    return false;
  }

  function requiresDocumentV2(doc) {
    if (doc?.structure?.format === 'mmcif') return true;

    const scene = doc?.scene || {};
    const savedViews = Array.isArray(scene.savedViews) ? scene.savedViews : [];
    if (DOCUMENT_V2_COLOR_MODES.has(scene.colorMode)
      || savedViews.some(view => DOCUMENT_V2_COLOR_MODES.has(view?.snapshot?.colorMode))) {
      return true;
    }

    const persistedSelectorValues = [scene.selection, scene.ligandAnalysis?.selectedLigand];
    persistedSelectorValues.push(...(Array.isArray(scene.customColors) ? scene.customColors : []));
    persistedSelectorValues.push(...(Array.isArray(scene.savedSelections) ? scene.savedSelections : []));
    for (const measurement of Array.isArray(scene.measurements) ? scene.measurements : []) {
      persistedSelectorValues.push(...(Array.isArray(measurement?.atoms) ? measurement.atoms : []));
    }
    for (const view of savedViews) {
      persistedSelectorValues.push(view?.snapshot?.selection);
      persistedSelectorValues.push(...(Array.isArray(view?.snapshot?.customColors)
        ? view.snapshot.customColors : []));
    }
    return persistedSelectorValues.some(selectorRequiresDocumentV2);
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
    for (const key of ['structureId', 'chain', 'icode', 'resn', 'atom', 'altLoc', 'instanceId', 'entityId', 'role', 'connectedComponentId']) {
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
    if (value.sourceIdentity && typeof value.sourceIdentity === 'object' && !Array.isArray(value.sourceIdentity)) {
      selector.sourceIdentity = normalizeSourceIdentity(value.sourceIdentity);
    }
    return selector;
  }

  function normalizeSourceIdentity(value) {
    const identity = { ...value };
    for (const key of [
      'atomSiteId', 'labelEntityId', 'labelAsymId', 'labelSeqId', 'labelCompId', 'labelAtomId', 'labelAltId',
      'authAsymId', 'authSeqId', 'authCompId', 'authAtomId', 'authAltId', 'insertionCode', 'pdbSerial'
    ]) {
      if (key in value && value[key] != null) identity[key] = String(value[key]);
    }
    if ('modelNumber' in value) {
      const modelNumber = Number(value.modelNumber);
      identity.modelNumber = Number.isFinite(modelNumber) ? modelNumber : value.modelNumber;
    }
    return identity;
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
      if (!selector.sourceIdentity && !validRequiredSelectorFields(selector, ['model', 'chain', 'resi', 'atom'])) {
        return selectionMatchError('Atom selector is missing model, chain, residue, or atom name.');
      }
      const resolution = resolveUniqueAtomSelector(selector, candidates, structureId);
      if (!resolution.valid) return selectionMatchError(resolution.error);
      matched = [resolution.atom];
    } else if (kind === 'residue') {
      if (selector.sourceIdentity) {
        matched = resolveAtomSelectorMatches(selector, candidates, structureId);
      } else if (!validRequiredSelectorFields(selector, ['model', 'chain', 'resi'])) {
        return selectionMatchError('Residue selector is missing model, chain, or residue number.');
      } else {
        matched = candidates.filter(atom =>
          atom.model === Number(selector.model) && atom.chain === selector.chain
          && atom.resi === Number(selector.resi)
          && (selector.icode == null || atom.icode === selector.icode)
          && (selector.resn == null || atom.resn === selector.resn)
        );
      }
    } else if (kind === 'chain') {
      if (!validRequiredSelectorFields(selector, ['model', 'chain'])) {
        return selectionMatchError('Chain selector is missing model or chain.');
      }
      matched = candidates.filter(atom => atom.model === Number(selector.model) && atom.chain === selector.chain);
    } else if (kind === 'instance') {
      if (!selector.instanceId && !selector.sourceIdentity?.labelAsymId) {
        return selectionMatchError('Molecular instance selector is missing instanceId or labelAsymId.');
      }
      matched = candidates.filter(atom =>
        (selector.instanceId == null || atom.instanceId === selector.instanceId)
        && (selector.sourceIdentity?.labelAsymId == null || atom.labelAsymId === selector.sourceIdentity.labelAsymId)
        && (selector.model == null || atom.model === Number(selector.model))
      );
    } else if (kind === 'entity') {
      if (!selector.entityId && !selector.sourceIdentity?.labelEntityId) {
        return selectionMatchError('Entity selector is missing entityId or labelEntityId.');
      }
      matched = candidates.filter(atom =>
        (selector.entityId == null || atom.entityId === selector.entityId)
        && (selector.sourceIdentity?.labelEntityId == null || atom.labelEntityId === selector.sourceIdentity.labelEntityId)
        && (selector.model == null || atom.model === Number(selector.model))
      );
    } else if (kind === 'role') {
      if (!['polymer', 'ligand', 'ion', 'solvent', 'unknown'].includes(selector.role)) {
        return selectionMatchError('Role selector must name polymer, ligand, ion, solvent, or unknown.');
      }
      matched = candidates.filter(atom => atom.role === selector.role
        && (selector.model == null || atom.model === Number(selector.model)));
    } else if (kind === 'connected-component') {
      if (selector.connectedComponentId == null) {
        return selectionMatchError('Connected-component selector is missing connectedComponentId.');
      }
      const componentIndex = Number(String(selector.connectedComponentId).replace(/^component-/, '')) - 1;
      matched = candidates.filter(atom => atom.connectedComponentIndex === componentIndex
        && (selector.model == null || atom.model === Number(selector.model)));
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
        isLigandLike(atom) && !isWater(atom)
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

    if (!matched.length) return selectionMatchError('Selector did not resolve to any atoms.');
    if (kind === 'residue' && countMatchedResidues(matched) !== 1) {
      return selectionMatchError('Residue selector is ambiguous across multiple residues.');
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
    return new Set(atoms.map(atom => Number.isInteger(atom.residueIndex)
      ? atom.residueIndex
      : `${atom.model}|${atom.chain}|${atom.resi}|${atom.icode}|${atom.resn}`)).size;
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
    if (kind === 'instance') return `Molecular instance ${selector.instanceId || selector.sourceIdentity?.labelAsymId || '?'}`;
    if (kind === 'entity') return `Entity ${selector.entityId || selector.sourceIdentity?.labelEntityId || '?'}`;
    if (kind === 'role') return `${selector.role || 'Unknown'} role`;
    if (kind === 'connected-component') return `Connected component ${selector.connectedComponentId || '?'}`;
    if (kind === 'residue-range') return `${chain} · residues ${selector.start?.resi ?? '?'}–${selector.end?.resi ?? '?'}`;
    if (kind === 'ligands') return selector.model == null ? 'All non-water ligands' : `Non-water ligands · model ${selector.model}`;
    if (kind === 'within') return `Within ${selector.cutoff ?? '?'} Å of ${describeSavedSelector(selector.target)}`;
    return 'Invalid or unsupported selector';
  }

  function normalizeLigandAnalysis(value, structureId, bindMissingStructureId = false) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const analysis = { ...source };
    const selected = source.selectedLigand;
    analysis.selectedLigand = selected && typeof selected === 'object' && !Array.isArray(selected)
      ? { ...selected, ...(bindMissingStructureId && !selected.structureId ? { structureId } : {}) }
      : null;
    analysis.cutoff = clamp(Number(source.cutoff) || LIGAND_ANALYSIS_DEFAULTS.cutoff, 2.5, 8);
    for (const key of ['showLigand', 'showPocket', 'showContacts', 'polarOnly']) {
      analysis[key] = key in source ? Boolean(source[key]) : LIGAND_ANALYSIS_DEFAULTS[key];
    }
    return analysis;
  }

  function normalizeInteractions(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const sourceTypes = source.types && typeof source.types === 'object' && !Array.isArray(source.types)
      ? source.types : {};
    return {
      ...source,
      enabled: 'enabled' in source ? Boolean(source.enabled) : INTERACTION_DEFAULTS.enabled,
      types: {
        ...sourceTypes,
        hydrogenBonds: 'hydrogenBonds' in sourceTypes
          ? Boolean(sourceTypes.hydrogenBonds) : INTERACTION_DEFAULTS.types.hydrogenBonds,
        saltBridges: 'saltBridges' in sourceTypes
          ? Boolean(sourceTypes.saltBridges) : INTERACTION_DEFAULTS.types.saltBridges
      },
      includeWater: 'includeWater' in source ? Boolean(source.includeWater) : INTERACTION_DEFAULTS.includeWater
    };
  }

  function ligandSelector(atom, structureId) {
    const selector = {
      structureId, model: atom.model, chain: atom.chain, resi: atom.resi,
      icode: atom.icode, resn: atom.resn
    };
    if (atom.sourceFormat === 'mmcif') {
      selector.instanceId = atom.instanceId;
      selector.sourceIdentity = sourceIdentityForAtom(atom, 'residue');
    }
    return selector;
  }

  function ligandKey(selector) {
    if (!selector) return '';
    if (selector.sourceIdentity?.labelAsymId) {
      const identity = selector.sourceIdentity;
      return [selector.structureId || '', Number(selector.model) || 1, identity.labelAsymId,
        identity.labelSeqId || identity.authSeqId || '', identity.labelCompId || identity.authCompId || '',
        identity.insertionCode || ''].join('|');
    }
    return `${selector.structureId || ''}|${Number(selector.model) || 1}|${selector.chain || '_'}|${Number(selector.resi) || 0}|${selector.icode || ''}|${selector.resn || 'UNK'}`;
  }

  function groupLigands(value, structureId = '') {
    const atoms = Array.isArray(value) ? value : value?.atoms;
    if (!Array.isArray(atoms)) return [];
    const ligands = [];
    const byKey = new Map();
    for (const atom of atoms) {
      if (!isLigandLike(atom) || isWater(atom)) continue;
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
    if (!selector.structureId || selector.structureId !== structureId) return null;
    const key = ligandKey(selector);
    const exact = ligands.find(ligand => ligand.key === key);
    if (exact) return exact;
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

    const eligible = atoms.filter(atom => atom.model === ligand.model && atom.element !== 'H'
      && (atom.role === 'polymer' || (!atom.het && ['protein', 'nucleic'].includes(residueDescriptor(atom.resn).kind))));
    const contacts = [];
    const search = requireStructureLayer().forEachNearbyPair(
      atoms,
      cutoff,
      (ligandAtom, targetAtom, distance) => {
          if (distance < .1) return;
          const vdwLimit = vdwRadius(ligandAtom.element) + vdwRadius(targetAtom.element) + .5;
          const close = distance <= Math.min(cutoff, vdwLimit);
          const polar = distance <= Math.min(cutoff, 3.5)
            && POLAR_ELEMENTS.has(ligandAtom.element) && POLAR_ELEMENTS.has(targetAtom.element);
          contacts.push({
            ligandAtom, targetAtom, distance, close, polar,
            classification: polar ? 'polar' : close ? 'close' : 'nearby'
          });
      },
      {
        leftIndices: ligand.atoms.filter(atom => atom.element !== 'H').map(atom => atom.index),
        rightIndices: eligible.map(atom => atom.index),
        unique: false
      }
    );
    contacts.sort((left, right) => left.distance - right.distance);

    const residueMap = new Map();
    for (const contact of contacts) {
      const atom = contact.targetAtom;
      const key = atom.residueIndex ?? `${atom.model}|${atom.chain}|${atom.resi}|${atom.icode}|${atom.resn}`;
      let residue = residueMap.get(key);
      if (!residue) {
        const descriptor = residueDescriptor(atom.resn);
        residue = {
          key, model: atom.model, chain: atom.chain, resi: atom.resi, icode: atom.icode,
          resn: atom.resn, kind: descriptor.kind, selector: selectorForAtom(atom, 'residue', structureId), atoms: [], contacts: [],
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
    return { cutoff, ligand, residues, contacts, candidatePairs: search.candidatePairs, indexedAtomCount: eligible.length };
  }

  const STANDARD_AMINO_ACIDS = new Set([
    'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
    'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL'
  ]);
  const AMINO_DONORS = Object.freeze({
    ARG: new Set(['NE', 'NH1', 'NH2']), ASN: new Set(['ND2']), GLN: new Set(['NE2']),
    LYS: new Set(['NZ']), SER: new Set(['OG']), THR: new Set(['OG1']),
    TRP: new Set(['NE1']), TYR: new Set(['OH'])
  });
  const AMINO_ACCEPTORS = Object.freeze({
    ASN: new Set(['OD1']), ASP: new Set(['OD1', 'OD2']), GLN: new Set(['OE1']),
    GLU: new Set(['OE1', 'OE2']), MET: new Set(['SD']), SER: new Set(['OG']),
    THR: new Set(['OG1']), TYR: new Set(['OH'])
  });
  const NUCLEOTIDE_DONORS = Object.freeze({
    A: new Set(['N6']), DA: new Set(['N6']), ADE: new Set(['N6']),
    C: new Set(['N4']), DC: new Set(['N4']), CYT: new Set(['N4']),
    G: new Set(['N1', 'N2']), DG: new Set(['N1', 'N2']), GUA: new Set(['N1', 'N2']),
    T: new Set(['N3']), DT: new Set(['N3']), THY: new Set(['N3']),
    U: new Set(['N3']), DU: new Set(['N3']), URA: new Set(['N3']), URI: new Set(['N3']),
    I: new Set(['N1']), DI: new Set(['N1'])
  });
  const NUCLEOTIDE_ACCEPTORS = Object.freeze({
    A: new Set(['N1', 'N3', 'N7']), DA: new Set(['N1', 'N3', 'N7']), ADE: new Set(['N1', 'N3', 'N7']),
    C: new Set(['N3', 'O2']), DC: new Set(['N3', 'O2']), CYT: new Set(['N3', 'O2']),
    G: new Set(['O6', 'N3', 'N7']), DG: new Set(['O6', 'N3', 'N7']), GUA: new Set(['O6', 'N3', 'N7']),
    T: new Set(['O2', 'O4']), DT: new Set(['O2', 'O4']), THY: new Set(['O2', 'O4']),
    U: new Set(['O2', 'O4']), DU: new Set(['O2', 'O4']), URA: new Set(['O2', 'O4']), URI: new Set(['O2', 'O4']),
    I: new Set(['O6', 'N3', 'N7']), DI: new Set(['O6', 'N3', 'N7'])
  });
  const NUCLEOTIDE_ACCEPTOR_ATOMS = new Set(['OP1', 'OP2', 'O1P', 'O2P', "O2'", "O3'", "O4'", "O5'"]);

  function analyzeInteractions(value, structureId = '') {
    const parsed = Array.isArray(value) ? { atoms: value, bonds: [], interactions: [] } : value;
    if (!parsed || !Array.isArray(parsed.atoms)) return emptyInteractionAnalysis(structureId);
    let cached = interactionAnalysisCache.get(parsed);
    if (!cached || cached.classifierVersion !== INTERACTION_CLASSIFIER_VERSION) {
      cached = buildInteractionInventory(parsed);
      interactionAnalysisCache.set(parsed, cached);
    }
    cached.serializedByStructureId ||= new Map();
    if (!cached.serializedByStructureId.has(structureId)) {
      cached.serializedByStructureId.set(structureId, serializeInteractionAnalysis(cached, parsed.atoms, structureId));
    }
    return cached.serializedByStructureId.get(structureId);
  }

  function emptyInteractionAnalysis(structureId) {
    return {
      structureId,
      classifierVersion: INTERACTION_CLASSIFIER_VERSION,
      interactions: [],
      counts: interactionCountSummary(new Map()),
      partitionCounts: emptyInteractionPartitionCounts(),
      search: {
        candidatePairs: 0, qualifyingPairs: 0, indexedAtomCount: 0,
        candidateWorkLimit: INTERACTION_CANDIDATE_WORK_LIMIT,
        saltSitePairLimit: INTERACTION_SALT_SITE_PAIR_LIMIT,
        retainedSaltSitePairs: 0,
        saltSitePairLimitReached: false,
        retainedRecords: 0, retainedLimit: INTERACTION_PARTITION_LIMIT * 4,
        truncated: false, partial: false, nearestComplete: true
      }
    };
  }

  function buildInteractionInventory(parsed) {
    const atoms = parsed.atoms;
    const adjacency = atoms.map(() => new Set());
    adjacency._atoms = atoms;
    for (const bond of parsed.bonds || []) {
      const [left, right] = bond.atomIndices || [];
      if (!atoms[left] || !atoms[right]) continue;
      adjacency[left].add(right);
      adjacency[right].add(left);
    }
    const partitions = new Map();
    const explicitKeys = new Set();
    const explicitByKey = new Map();
    for (const sourceRecord of parsed.interactions || []) {
      const record = normalizeExplicitInteraction(sourceRecord, atoms);
      if (!record) continue;
      const key = interactionDedupKey(record);
      explicitKeys.add(key);
      const existing = explicitByKey.get(key);
      if (existing) {
        existing.sources.push(...record.sources);
        if (existing.reportedDistance == null) existing.reportedDistance = record.reportedDistance;
      } else {
        explicitByKey.set(key, record);
        accumulateInteraction(partitions, record);
      }
    }

    const saltSitePairs = new Map();
    let saltSitePairLimitReached = false;
    const search = requireStructureLayer().forEachNearbyPair(
      atoms,
      4,
      (left, right, distance) => {
        if (left.element === 'H' || right.element === 'H') return;
        if (!requireStructureLayer().alternateLocationsCompatible(left, right)) return;
        if (left.residueIndex === right.residueIndex) return;
        if (hasShortCovalentPath(left.index, right.index, adjacency)) return;

        if (distance >= 2.5 && distance <= 3.5) {
          const hydrogenBond = classifyHydrogenBond(left, right, distance, adjacency);
          if (hydrogenBond && !explicitKeys.has(interactionDedupKey(hydrogenBond))) {
            accumulateInteraction(partitions, hydrogenBond);
          }
        }

        const leftSite = chargedSite(left);
        const rightSite = chargedSite(right);
        if (!leftSite || !rightSite || leftSite.sign === rightSite.sign) return;
        const positive = leftSite.sign > 0 ? { atom: left, site: leftSite } : { atom: right, site: rightSite };
        const negative = leftSite.sign < 0 ? { atom: left, site: leftSite } : { atom: right, site: rightSite };
        const sitePairKey = `${positive.site.key}|${negative.site.key}`;
        const existing = saltSitePairs.get(sitePairKey);
        if (!existing && saltSitePairs.size >= INTERACTION_SALT_SITE_PAIR_LIMIT) {
          saltSitePairLimitReached = true;
          return false;
        }
        const candidate = inferredInteraction(
          'salt-bridge', positive.atom, 'positive', negative.atom, 'negative', distance, 'possible'
        );
        if (!existing || compareInteractions(candidate, existing) < 0) saltSitePairs.set(sitePairKey, candidate);
      },
      { compatibleAlternates: true, maxCandidatePairs: INTERACTION_CANDIDATE_WORK_LIMIT }
    );

    for (const record of saltSitePairs.values()) {
      if (!explicitKeys.has(interactionDedupKey(record))) accumulateInteraction(partitions, record);
    }
    const interactions = [...partitions.values()].flatMap(partition => heapSorted(partition.heap));
    interactions.sort(compareInteractions);
    const truncated = search.truncated || saltSitePairLimitReached;
    return {
      classifierVersion: INTERACTION_CLASSIFIER_VERSION,
      interactions,
      partitionCounts: partitionCountObject(partitions),
      counts: interactionCountSummary(partitions),
      search: {
        ...search,
        candidateWorkLimit: INTERACTION_CANDIDATE_WORK_LIMIT,
        saltSitePairLimit: INTERACTION_SALT_SITE_PAIR_LIMIT,
        retainedSaltSitePairs: saltSitePairs.size,
        saltSitePairLimitReached,
        retainedRecords: interactions.length,
        retainedLimit: INTERACTION_PARTITION_LIMIT * 4,
        truncated,
        partial: truncated,
        nearestComplete: !truncated
      }
    };
  }

  function normalizeExplicitInteraction(value, atoms) {
    if (!value || !['hydrogen-bond', 'salt-bridge'].includes(value.type) || !Array.isArray(value.participants)) return null;
    const participants = value.participants.slice(0, 2).map(participant => ({
      atomIndex: Number(participant?.atomIndex), role: String(participant?.role || 'participant')
    }));
    if (participants.length !== 2 || participants.some(participant => !atoms[participant.atomIndex])) return null;
    const left = atoms[participants[0].atomIndex];
    const right = atoms[participants[1].atomIndex];
    return {
      type: value.type,
      participants,
      direction: value.type === 'hydrogen-bond' ? (value.direction === 'directed' ? 'directed' : 'ambiguous') : null,
      distance: Number.isFinite(Number(value.distance)) ? Number(value.distance) : magnitude(subtract(left, right)),
      reportedDistance: Number.isFinite(Number(value.reportedDistance)) ? Number(value.reportedDistance) : null,
      sources: Array.isArray(value.sources) ? structuredClone(value.sources) : [],
      heuristicQuality: null,
      model: Number(value.model) || left.model,
      hasWaterEndpoint: isWater(left) || isWater(right)
    };
  }

  function classifyHydrogenBond(left, right, distance, adjacency) {
    const forward = hydrogenBondDirection(left, right, adjacency);
    const reverse = hydrogenBondDirection(right, left, adjacency);
    if (!forward && !reverse) return null;
    if (forward && !reverse) return inferredInteraction(
      'hydrogen-bond', left, 'donor', right, 'acceptor', distance, forward.quality, 'directed'
    );
    if (reverse && !forward) return inferredInteraction(
      'hydrogen-bond', right, 'donor', left, 'acceptor', distance, reverse.quality, 'directed'
    );
    if (forward.quality === 'strict' && reverse.quality !== 'strict') return inferredInteraction(
      'hydrogen-bond', left, 'donor', right, 'acceptor', distance, 'strict', 'directed'
    );
    if (reverse.quality === 'strict' && forward.quality !== 'strict') return inferredInteraction(
      'hydrogen-bond', right, 'donor', left, 'acceptor', distance, 'strict', 'directed'
    );
    if (forward.quality === 'strict' && reverse.quality === 'strict' && forward.score !== reverse.score) {
      const selected = forward.score > reverse.score
        ? [left, right] : [right, left];
      return inferredInteraction(
        'hydrogen-bond', selected[0], 'donor', selected[1], 'acceptor', distance, 'strict', 'directed'
      );
    }
    return inferredInteraction(
      'hydrogen-bond', left, 'donor-or-acceptor', right, 'donor-or-acceptor',
      distance, 'possible', 'ambiguous'
    );
  }

  function hydrogenBondDirection(donor, acceptor, adjacency) {
    if (!isHydrogenBondAcceptor(acceptor, adjacency)) return null;
    if (!['N', 'O', 'S'].includes(donor.element)) return null;
    const hydrogens = [...adjacency[donor.index]].map(index => adjacencyAtom(index, donor, acceptor))
      .filter(atom => atom?.element === 'H');
    if (hydrogens.length) {
      let best = null;
      for (const hydrogen of hydrogens) {
        const hydrogenDistance = magnitude(subtract(hydrogen, acceptor));
        if (hydrogenDistance > 2.6) continue;
        const angle = angleAt(hydrogen, donor, acceptor);
        if (angle < 120) continue;
        const score = angle * 10 - hydrogenDistance;
        if (!best || score > best.score) best = { quality: 'strict', score };
      }
      return best;
    }
    return isPossibleHydrogenBondDonor(donor) ? { quality: 'possible', score: 0 } : null;

    function adjacencyAtom(index) { return adjacency._atoms?.[index] || null; }
  }

  function isPossibleHydrogenBondDonor(atom) {
    const residue = String(atom.resn || '').toUpperCase();
    const name = canonicalAtomName(atom.name);
    if (isWater(atom)) return atom.element === 'O';
    if (STANDARD_AMINO_ACIDS.has(residue)) {
      if (name === 'N') return residue !== 'PRO';
      return AMINO_DONORS[residue]?.has(name) || false;
    }
    return NUCLEOTIDE_DONORS[residue]?.has(name) || false;
  }

  function isHydrogenBondAcceptor(atom, adjacency) {
    if (!['N', 'O', 'S'].includes(atom.element) || Number(atom.formalCharge) > 0) return false;
    if (Number(atom.formalCharge) < 0) return true;
    const residue = String(atom.resn || '').toUpperCase();
    const name = canonicalAtomName(atom.name);
    if (isWater(atom)) return atom.element === 'O';
    if (STANDARD_AMINO_ACIDS.has(residue)) {
      if (name === 'O' || name === 'OXT') return true;
      if (residue === 'HIS' && ['ND1', 'NE2'].includes(name)) {
        const residueAtoms = adjacency._atoms?.filter(candidate => candidate.residueIndex === atom.residueIndex) || [];
        const residuePositive = residueAtoms.some(candidate => Number(candidate.formalCharge) > 0);
        const hasHydrogen = [...adjacency[atom.index]].some(index => adjacency._atoms?.[index]?.element === 'H');
        return !residuePositive && !hasHydrogen;
      }
      return AMINO_ACCEPTORS[residue]?.has(name) || false;
    }
    return NUCLEOTIDE_ACCEPTORS[residue]?.has(name) || NUCLEOTIDE_ACCEPTOR_ATOMS.has(name) || false;
  }

  function canonicalAtomName(value) {
    return String(value || '').trim().toUpperCase().replace(/\*$/, "'");
  }

  function chargedSite(atom) {
    const residue = String(atom.resn || '').toUpperCase();
    const name = canonicalAtomName(atom.name);
    let sign = null;
    let siteName = null;
    if (atom.formalCharge != null) sign = Math.sign(Number(atom.formalCharge));
    if (residue === 'ARG' && ['NE', 'NH1', 'NH2'].includes(name)) siteName = 'arginine-guanidinium';
    else if (residue === 'LYS' && name === 'NZ') siteName = 'lysine-amino';
    else if (residue === 'ASP' && ['OD1', 'OD2'].includes(name)) siteName = 'aspartate-carboxylate';
    else if (residue === 'GLU' && ['OE1', 'OE2'].includes(name)) siteName = 'glutamate-carboxylate';
    if (atom.formalCharge == null) {
      if (siteName === 'arginine-guanidinium' || siteName === 'lysine-amino') sign = 1;
      else if (siteName === 'aspartate-carboxylate' || siteName === 'glutamate-carboxylate') sign = -1;
    }
    if (!sign) return null;
    return {
      sign,
      key: siteName
        ? `${atom.model}|${atom.residueIndex}|${siteName}`
        : `${atom.model}|${atom.index}|formal-charge`
    };
  }

  function inferredInteraction(type, left, leftRole, right, rightRole, distance, quality, direction = null) {
    return {
      type,
      participants: [
        { atomIndex: left.index, role: leftRole },
        { atomIndex: right.index, role: rightRole }
      ],
      direction: type === 'hydrogen-bond' ? direction : null,
      distance,
      reportedDistance: null,
      sources: [{ kind: 'inferred', classifierVersion: INTERACTION_CLASSIFIER_VERSION }],
      heuristicQuality: quality,
      model: left.model,
      hasWaterEndpoint: isWater(left) || isWater(right)
    };
  }

  function hasShortCovalentPath(leftIndex, rightIndex, adjacency) {
    if (adjacency[leftIndex].has(rightIndex)) return true;
    for (const neighbor of adjacency[leftIndex]) if (adjacency[neighbor]?.has(rightIndex)) return true;
    return false;
  }

  function angleAt(center, left, right) {
    const a = subtract(left, center);
    const b = subtract(right, center);
    const denominator = magnitude(a) * magnitude(b);
    if (denominator < 1e-12) return 0;
    return Math.acos(clamp(dot(a, b) / denominator, -1, 1)) * 180 / Math.PI;
  }

  function interactionDedupKey(record) {
    return `${record.type}|${canonicalInteractionPairKey(record)}`;
  }

  function canonicalInteractionPairKey(record) {
    const [left, right] = record.participants.map(participant => participant.atomIndex);
    return `${Math.min(left, right)}:${Math.max(left, right)}`;
  }

  function compareInteractions(left, right) {
    const distanceDifference = Number(left.distance) - Number(right.distance);
    if (Math.abs(distanceDifference) > 1e-12) return distanceDifference;
    const pairDifference = canonicalInteractionPairKey(left)
      .localeCompare(canonicalInteractionPairKey(right), 'en', { numeric: true });
    return pairDifference || left.type.localeCompare(right.type);
  }

  function interactionPartitionKey(record) {
    return `${record.type}|${record.hasWaterEndpoint ? 'water' : 'dry'}`;
  }

  function accumulateInteraction(partitions, record) {
    const key = interactionPartitionKey(record);
    let partition = partitions.get(key);
    if (!partition) {
      partition = { count: 0, explicit: 0, inferred: 0, heap: [] };
      partitions.set(key, partition);
    }
    partition.count += 1;
    if (record.heuristicQuality == null) partition.explicit += 1;
    else partition.inferred += 1;
    heapRetainNearest(partition.heap, record, INTERACTION_PARTITION_LIMIT);
  }

  function heapRetainNearest(heap, record, limit) {
    if (heap.length < limit) {
      heap.push(record);
      let index = heap.length - 1;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (compareInteractions(heap[index], heap[parent]) <= 0) break;
        [heap[index], heap[parent]] = [heap[parent], heap[index]];
        index = parent;
      }
      return;
    }
    if (compareInteractions(record, heap[0]) >= 0) return;
    heap[0] = record;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let worst = index;
      if (left < heap.length && compareInteractions(heap[left], heap[worst]) > 0) worst = left;
      if (right < heap.length && compareInteractions(heap[right], heap[worst]) > 0) worst = right;
      if (worst === index) break;
      [heap[index], heap[worst]] = [heap[worst], heap[index]];
      index = worst;
    }
  }

  function heapSorted(heap) { return [...heap].sort(compareInteractions); }

  function emptyInteractionPartitionCounts() {
    return {
      hydrogenBonds: { withoutWater: 0, withWater: 0 },
      saltBridges: { withoutWater: 0, withWater: 0 }
    };
  }

  function partitionCountObject(partitions) {
    const counts = emptyInteractionPartitionCounts();
    counts.hydrogenBonds.withoutWater = partitions.get('hydrogen-bond|dry')?.count || 0;
    counts.hydrogenBonds.withWater = partitions.get('hydrogen-bond|water')?.count || 0;
    counts.saltBridges.withoutWater = partitions.get('salt-bridge|dry')?.count || 0;
    counts.saltBridges.withWater = partitions.get('salt-bridge|water')?.count || 0;
    return counts;
  }

  function interactionCountSummary(partitions) {
    let total = 0, explicit = 0, inferred = 0, hydrogenBonds = 0, saltBridges = 0, withWater = 0;
    for (const [key, partition] of partitions) {
      total += partition.count;
      explicit += partition.explicit;
      inferred += partition.inferred;
      if (key.startsWith('hydrogen-bond|')) hydrogenBonds += partition.count;
      else saltBridges += partition.count;
      if (key.endsWith('|water')) withWater += partition.count;
    }
    return { total, hydrogenBonds, saltBridges, withWater, withoutWater: total - withWater, explicit, inferred };
  }

  function serializeInteractionAnalysis(analysis, atoms, structureId) {
    return {
      structureId,
      classifierVersion: analysis.classifierVersion,
      interactions: analysis.interactions.map(record => ({
        ...structuredClone(record),
        participants: record.participants.map(participant => ({
          ...participant,
          selector: { kind: 'atom', ...selectorForAtom(atoms[participant.atomIndex], 'atom', structureId) }
        }))
      })),
      counts: structuredClone(analysis.counts),
      partitionCounts: structuredClone(analysis.partitionCounts),
      search: structuredClone(analysis.search)
    };
  }

  function selectInteractions(analysis, value, limitValue = INTERACTION_RENDER_LIMIT) {
    const state = normalizeInteractions(value);
    const limit = Math.max(0, Math.min(INTERACTION_RENDER_LIMIT, Number(limitValue) || INTERACTION_RENDER_LIMIT));
    const typeEnabled = type => type === 'hydrogen-bond'
      ? state.types.hydrogenBonds : state.types.saltBridges;
    const selected = state.enabled
      ? (analysis?.interactions || []).filter(record =>
        typeEnabled(record.type) && (state.includeWater || !record.hasWaterEndpoint)
      ).sort(compareInteractions).slice(0, limit)
      : [];
    const partitionCounts = analysis?.partitionCounts || emptyInteractionPartitionCounts();
    let total = 0;
    if (state.enabled && state.types.hydrogenBonds) {
      total += partitionCounts.hydrogenBonds.withoutWater;
      if (state.includeWater) total += partitionCounts.hydrogenBonds.withWater;
    }
    if (state.enabled && state.types.saltBridges) {
      total += partitionCounts.saltBridges.withoutWater;
      if (state.includeWater) total += partitionCounts.saltBridges.withWater;
    }
    return {
      interactions: selected,
      total,
      rendered: selected.length,
      omitted: Math.max(0, total - selected.length),
      truncated: Boolean(analysis?.search?.truncated),
      partial: Boolean(analysis?.search?.partial)
    };
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
    if ('interactions' in snapshot) snapshot.interactions = normalizeInteractions(snapshot.interactions);
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
    if (scope === 'instance') return {
      ...base, instanceId: atom.instanceId,
      sourceIdentity: compactSourceIdentity({ modelNumber: atom.model, labelAsymId: atom.labelAsymId })
    };
    if (scope === 'entity') return {
      ...base, entityId: atom.entityId,
      sourceIdentity: compactSourceIdentity({ modelNumber: atom.model, labelEntityId: atom.labelEntityId })
    };
    if (scope === 'role') return { ...base, role: atom.role || 'unknown' };
    if (scope === 'connected-component') return { ...base, connectedComponentId: `component-${Number(atom.connectedComponentIndex) + 1}` };
    const legacyResidue = { ...base, chain: atom.chain, resi: atom.resi, icode: atom.icode, resn: atom.resn };
    if (scope === 'residue') {
      return atom.sourceFormat === 'mmcif'
        ? { ...legacyResidue, sourceIdentity: sourceIdentityForAtom(atom, 'residue') }
        : legacyResidue;
    }
    const legacyAtom = { ...legacyResidue, atom: atom.name, altLoc: atom.altLoc, serial: atom.serial };
    return atom.sourceFormat === 'mmcif'
      ? { ...legacyAtom, sourceIdentity: sourceIdentityForAtom(atom, 'atom') }
      : legacyAtom;
  }

  function sourceIdentityForAtom(atom, scope = 'atom') {
    const identity = {
      modelNumber: atom.model,
      labelEntityId: atom.labelEntityId,
      labelAsymId: atom.labelAsymId,
      labelSeqId: atom.labelSeqId,
      labelCompId: atom.labelCompId,
      authAsymId: atom.authAsymId,
      authSeqId: atom.authSeqId,
      authCompId: atom.authCompId,
      insertionCode: atom.icode
    };
    if (scope === 'atom') Object.assign(identity, {
      atomSiteId: atom.atomSiteId,
      labelAtomId: atom.labelAtomId,
      labelAltId: atom.labelAltId,
      authAtomId: atom.authAtomId,
      authAltId: atom.authAltId,
      pdbSerial: atom.sourceFormat === 'pdb' ? atom.serial : null
    });
    return compactSourceIdentity(identity);
  }

  function compactSourceIdentity(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry != null && entry !== ''));
  }

  function atomMatchesLegacyIdentity(atom, selector) {
    const model = selector.model ?? selector.sourceIdentity?.modelNumber;
    if (model != null && Number(model) !== atom.model) return false;
    if (selector.chain != null && selector.chain !== atom.chain) return false;
    if (selector.resi != null && Number(selector.resi) !== atom.resi) return false;
    if (selector.icode != null && selector.icode !== atom.icode) return false;
    if (selector.resn != null && selector.resn !== atom.resn) return false;
    if (selector.atom != null && selector.atom !== atom.name) return false;
    if (selector.altLoc != null && selector.altLoc !== atom.altLoc) return false;
    if (selector.serial != null && Number(selector.serial) !== atom.serial) return false;
    return true;
  }

  function atomMatchesSelectorSemantics(atom, selector) {
    if (selector.instanceId != null && selector.instanceId !== atom.instanceId) return false;
    if (selector.entityId != null && selector.entityId !== atom.entityId) return false;
    if (selector.role != null && selector.role !== atom.role) return false;
    if (selector.connectedComponentId != null
      && Number(String(selector.connectedComponentId).replace(/^component-/, '')) - 1 !== atom.connectedComponentIndex) return false;
    return true;
  }

  function atomMatchesSelector(atom, selector, structureId) {
    if (!selector || selector.structureId !== structureId) return false;
    if (!atomMatchesSelectorSemantics(atom, selector)) return false;
    if (!selector.sourceIdentity) return atomMatchesLegacyIdentity(atom, selector);
    const identity = normalizeSourceIdentity(selector.sourceIdentity);
    const tier = preferredSourceIdentityTier(identity);
    return tier ? sourceIdentityMatchesTier(atom, identity, tier) : atomMatchesLegacyIdentity(atom, selector);
  }

  function resolveAtomSelectorMatches(selector, atoms, structureId) {
    if (!selector || typeof selector !== 'object' || Array.isArray(selector)) return [];
    if (!selector.structureId || selector.structureId !== structureId) return [];
    const candidates = Array.isArray(atoms) ? atoms : [];
    if (selector.sourceIdentity) {
      const sourceMatches = resolveSourceIdentityMatches(selector.sourceIdentity, candidates);
      if (sourceMatches.length) return sourceMatches.filter(atom => atomMatchesSelectorSemantics(atom, selector));
    }
    return candidates.filter(atom => atomMatchesLegacyIdentity(atom, selector)
      && atomMatchesSelectorSemantics(atom, selector));
  }

  function resolveUniqueAtomSelector(selector, atoms, structureId) {
    if (!selector?.structureId) return { valid: false, error: 'Atom selector is missing structureId.', atom: null };
    if (selector.structureId !== structureId) return { valid: false, error: 'Atom selector belongs to a different structure.', atom: null };
    const matches = resolveAtomSelectorMatches(selector, atoms, structureId);
    if (!matches.length) return { valid: false, error: 'Atom selector did not resolve to any atoms.', atom: null };
    if (matches.length > 1) return { valid: false, error: 'Atom selector is ambiguous across multiple atoms.', atom: null };
    return { valid: true, error: null, atom: matches[0] };
  }

  const LABEL_IDENTITY_FIELDS = [
    ['labelEntityId', 'labelEntityId'], ['labelAsymId', 'labelAsymId'], ['labelSeqId', 'labelSeqId'],
    ['labelCompId', 'labelCompId'], ['labelAtomId', 'labelAtomId'], ['labelAltId', 'labelAltId']
  ];
  const AUTHOR_IDENTITY_FIELDS = [
    ['authAsymId', 'authAsymId'], ['authSeqId', 'authSeqId'], ['authCompId', 'authCompId'],
    ['authAtomId', 'authAtomId'], ['authAltId', 'authAltId'], ['insertionCode', 'icode']
  ];

  function preferredSourceIdentityTier(identity) {
    if (identity.atomSiteId != null) return 'atom-site';
    if (LABEL_IDENTITY_FIELDS.some(([key]) => identity[key] != null)) return 'label';
    if (AUTHOR_IDENTITY_FIELDS.some(([key]) => identity[key] != null)) return 'author';
    if (identity.pdbSerial != null) return 'legacy-serial';
    return null;
  }

  function sourceIdentityMatchesTier(atom, identity, tier) {
    if (identity.modelNumber != null && Number(identity.modelNumber) !== atom.model) return false;
    if (tier === 'atom-site') return String(atom.atomSiteId) === String(identity.atomSiteId);
    if (tier === 'label') {
      return LABEL_IDENTITY_FIELDS.every(([key, atomKey]) =>
        identity[key] == null || String(atom[atomKey] ?? '') === String(identity[key]));
    }
    if (tier === 'author') return AUTHOR_IDENTITY_FIELDS.every(([key, atomKey]) =>
      identity[key] == null || String(atom[atomKey] ?? '') === String(identity[key]));
    if (tier === 'legacy-serial') return Number(identity.pdbSerial) === atom.serial;
    return false;
  }

  function resolveSourceIdentityMatches(value, atoms) {
    const identity = normalizeSourceIdentity(value);
    const tiers = [];
    if (identity.atomSiteId != null) tiers.push('atom-site');
    if (LABEL_IDENTITY_FIELDS.some(([key]) => identity[key] != null)) tiers.push('label');
    if (AUTHOR_IDENTITY_FIELDS.some(([key]) => identity[key] != null)) tiers.push('author');
    if (identity.pdbSerial != null) tiers.push('legacy-serial');
    for (const tier of tiers) {
      let matched = atoms.filter(atom => sourceIdentityMatchesTier(atom, identity, tier));
      if (tier === 'label' && matched.length > 1 && identity.labelAltId == null && identity.authAltId != null) {
        const narrowed = matched.filter(atom => String(atom.authAltId ?? '') === String(identity.authAltId));
        if (narrowed.length) matched = narrowed;
      }
      if (matched.length) return matched;
    }
    return [];
  }

  function atomIdentity(atom, structureId) {
    return {
      kind: 'atom', structureId, model: atom.model, chain: atom.chain,
      residueName: atom.resn, residueNumber: atom.resi, insertionCode: atom.icode,
      atomName: atom.name, alternateLocation: atom.altLoc, serial: atom.serial,
      element: atom.element, instanceId: atom.instanceId, entityId: atom.entityId,
      role: atom.role || 'unknown', sourceIdentity: sourceIdentityForAtom(atom, 'atom')
    };
  }

  function measurementAtoms(measurement, atoms, structureId) {
    const expected = MEASUREMENT_ATOM_COUNTS[measurement?.type];
    if (!expected || !Array.isArray(measurement.atoms) || measurement.atoms.length !== expected) return null;
    const resolved = measurement.atoms.map(selector => resolveUniqueAtomSelector(selector, atoms, structureId));
    return resolved.every(match => match.valid) ? resolved.map(match => match.atom) : null;
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
      if (resolvedSelectorAtomIndexes(rules[i].selector, parsed?.atoms || [], doc.structure.id).has(atom.index)) return rules[i].color;
    }
    if (doc.scene.colorMode === 'chain' || doc.scene.colorMode === 'author-chain') return chainColor(atom.chain, parsed.chains);
    if (doc.scene.colorMode === 'instance') {
      const instances = parsed.topology?.instances?.map(instance => instance.id) || [...new Set(parsed.atoms.map(candidate => candidate.instanceId))];
      return chainColor(atom.instanceId, instances);
    }
    if (doc.scene.colorMode === 'entity') {
      const entities = parsed.topology?.entities?.map(entity => entity.id) || [...new Set(parsed.atoms.map(candidate => candidate.entityId))];
      return chainColor(atom.entityId, entities);
    }
    if (doc.scene.colorMode === 'role') return ROLE_COLORS[atom.role] || ROLE_COLORS.unknown;
    if (doc.scene.colorMode === 'residue') {
      const key = `${atom.instanceId}|${atom.sourceFormat === 'mmcif' && atom.labelSeqId || atom.authSeqId || atom.resi}|${atom.icode}`;
      const index = [...key].reduce((hash, character) => (hash * 31 + character.charCodeAt()) | 0, 0);
      return CHAIN_COLORS[Math.abs(index) % CHAIN_COLORS.length];
    }
    if (doc.scene.colorMode === 'uniform') return '#7db7ff';
    return ELEMENT_COLORS[atom.element] || '#d5d9e0';
  }

  function resolvedSelectorAtomIndexes(selector, atoms, structureId) {
    if (!selector || typeof selector !== 'object' || Array.isArray(selector)) return new Set();
    const cached = resolvedSelectorIndexCache.get(selector);
    if (cached?.atoms === atoms && cached.structureId === structureId) return cached.indexes;
    const indexes = new Set(resolveAtomSelectorMatches(selector, atoms, structureId).map(atom => atom.index));
    resolvedSelectorIndexCache.set(selector, { atoms, structureId, indexes });
    return indexes;
  }

  function isWater(atom) { return WATER_NAMES.has(atom.resn); }
  function isLigandLike(atom) {
    return atom.role && atom.role !== 'unknown' ? ['ligand', 'ion'].includes(atom.role) : Boolean(atom.het);
  }
  function vdwRadius(element) { return VDW_RADII[element] || 1.7; }

  window.MolhtmlCore = {
    ELEMENT_COLORS, CHAIN_COLORS, ROLE_COLORS, parsePDB, parseStructure, parsePDBMetadata, parseMmcifMetadata,
    normalizeMetadata, mergeMetadata, metadataFromRCSBEntry, deriveDataQuality, normalizeDocument,
    requiresDocumentV2, applyDocumentCommand, selectorForAtom, sourceIdentityForAtom,
    atomMatchesSelector, atomIdentity, atomLabel, colorForAtom, isWater, vdwRadius, uid,
    MEASUREMENT_ATOM_COUNTS, normalizeMeasurements, measurementAtoms, measurementValue,
    formatMeasurementValue,
    normalizeSavedSelections, normalizeCompoundSelector, matchSavedSelection, resolveUniqueAtomSelector, describeSavedSelector,
    residueDescriptor, buildStructureHierarchy, representativeAtom,
    LIGAND_ANALYSIS_DEFAULTS, normalizeLigandAnalysis, ligandSelector, ligandKey, ligandLabel,
    groupLigands, findLigand, analyzeLigandPocket,
    INTERACTION_DEFAULTS, INTERACTION_CLASSIFIER_VERSION, normalizeInteractions,
    analyzeInteractions, selectInteractions,
    SAVED_VIEW_SCENE_FIELDS, normalizeSavedViews, normalizeSavedViewSnapshot,
    captureSavedViewSnapshot, applySavedViewSnapshot, reorderSavedViews, validCamera
  };
})();
