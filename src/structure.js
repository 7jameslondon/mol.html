(function () {
  'use strict';

  const WATER_NAMES = new Set(['HOH', 'WAT', 'H2O', 'DOD']);
  const AMINO_ACIDS = new Set([
    'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
    'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL',
    'ASX', 'GLX', 'SEC', 'PYL', 'UNK'
  ]);
  const NUCLEOTIDES = new Set([
    'A', 'C', 'G', 'I', 'T', 'U', 'DA', 'DC', 'DG', 'DI', 'DT', 'DU',
    'ADE', 'CYT', 'GUA', 'THY', 'URI'
  ]);
  const ION_NAMES = new Set([
    'AL', 'BA', 'BR', 'CA', 'CD', 'CL', 'CO', 'CS', 'CU', 'FE', 'HG', 'I',
    'K', 'LI', 'MG', 'MN', 'NA', 'NI', 'PB', 'RB', 'SR', 'ZN'
  ]);
  const COVALENT_RADII = {
    H: .31, C: .76, N: .71, O: .66, F: .57, P: 1.07, S: 1.05,
    CL: 1.02, BR: 1.2, I: 1.39, FE: 1.24, MG: 1.3, ZN: 1.22, CA: 1.76
  };
  const MAX_ATOMS = 2_000_000;
  const spatialIndexCache = new WeakMap();

  function normalizeStructureFormat(value) {
    const format = String(value || '').trim().toLowerCase().replace(/^\./, '');
    if (['pdb', 'ent'].includes(format)) return 'pdb';
    if (['cif', 'mmcif', 'pdbx', 'pdbx/mmcif'].includes(format)) return 'mmcif';
    return '';
  }

  function detectStructureFormat(data, hint = '') {
    const hinted = normalizeStructureFormat(hint);
    const text = String(data || '').replace(/^\uFEFF/, '');
    if (/^\s*data_[^\s]*/im.test(text) && /(?:^|\n)\s*_atom_site\./im.test(text)) return 'mmcif';
    if (/^(?:ATOM  |HETATM|MODEL )/m.test(text)) return 'pdb';
    if (hinted) return hinted;
    throw new Error('Could not detect a supported molecular coordinate format. Open a PDB or text mmCIF file.');
  }

  function parseStructure(data, hint = '') {
    const format = detectStructureFormat(data, hint);
    return format === 'mmcif' ? parseMmcif(data) : parsePDBCoordinates(data);
  }

  function inferElement(rawName, explicit) {
    const provided = String(explicit || '').trim().toUpperCase();
    if (provided && /^[A-Z]{1,2}$/.test(provided)) return provided;
    const letters = String(rawName || '').replace(/[^A-Za-z]/g, '').toUpperCase();
    if (!letters) return 'C';
    if (letters.length > 1 && ['CL', 'BR', 'FE', 'MG', 'ZN', 'CA', 'NA', 'MN', 'CU', 'NI', 'CO'].includes(letters.slice(0, 2))) {
      return letters.slice(0, 2);
    }
    return letters[0];
  }

  function parsePDBCoordinates(value) {
    const text = String(value || '');
    const atoms = [];
    const explicitBondSerials = new Set();
    const serialMap = new Map();
    let model = 1;
    const lines = text.replace(/\r/g, '').split('\n');
    const diagnostics = {
      coordinateLines: 0,
      skippedCoordinateLines: 0,
      malformedCoordinateLines: 0,
      malformedLineNumbers: [],
      parserWarnings: []
    };

    let lineNumber = 0;
    for (const line of lines) {
      lineNumber += 1;
      const record = line.slice(0, 6).trim().toUpperCase();
      if (record === 'MODEL') {
        model = Number.parseInt(line.slice(10, 14), 10) || model;
        continue;
      }
      if (record === 'ATOM' || record === 'HETATM') {
        diagnostics.coordinateLines += 1;
        const serial = Number.parseInt(line.slice(6, 11), 10) || atoms.length + 1;
        const rawName = line.slice(12, 16);
        const chain = line.slice(21, 22).trim() || '_';
        const resn = line.slice(17, 20).trim() || 'UNK';
        const resi = Number.parseInt(line.slice(22, 26), 10) || 0;
        const atom = {
          index: atoms.length,
          serial,
          name: rawName.trim() || 'X',
          altLoc: line.slice(16, 17).trim(),
          resn,
          chain,
          resi,
          icode: line.slice(26, 27).trim(),
          x: Number.parseFloat(line.slice(30, 38)),
          y: Number.parseFloat(line.slice(38, 46)),
          z: Number.parseFloat(line.slice(46, 54)),
          occupancy: finiteOr(line.slice(54, 60), 0),
          bfactor: finiteOr(line.slice(60, 66), 0),
          element: inferElement(rawName, line.slice(76, 78)),
          het: record === 'HETATM',
          model,
          sourceFormat: 'pdb',
          atomSiteId: null,
          labelEntityId: null,
          labelAsymId: null,
          labelSeqId: null,
          labelCompId: resn,
          labelAtomId: rawName.trim() || 'X',
          labelAltId: line.slice(16, 17).trim(),
          authAsymId: chain,
          authSeqId: resi,
          authCompId: resn,
          authAtomId: rawName.trim() || 'X',
          identityProvenance: 'pdb-source'
        };
        if ([atom.x, atom.y, atom.z].every(Number.isFinite)) {
          if (atoms.length >= MAX_ATOMS) throw new Error(`The structure exceeds the ${MAX_ATOMS.toLocaleString()} atom safety limit.`);
          atoms.push(atom);
          serialMap.set(`${model}|${serial}`, atom.index);
          if (!serialMap.has(`*|${serial}`)) serialMap.set(`*|${serial}`, atom.index);
        } else {
          diagnostics.skippedCoordinateLines += 1;
          diagnostics.malformedCoordinateLines += 1;
          if (diagnostics.malformedLineNumbers.length < 20) diagnostics.malformedLineNumbers.push(lineNumber);
        }
        continue;
      }
      if (record === 'CONECT') {
        const values = line.slice(6).match(/.{1,5}/g)?.map(part => Number.parseInt(part, 10)).filter(Number.isFinite) || [];
        const source = values.shift();
        for (const target of values) {
          if (source === target) continue;
          explicitBondSerials.add(source < target ? `${source}:${target}` : `${target}:${source}`);
        }
      }
    }

    if (!atoms.length) throw new Error('No ATOM or HETATM coordinates were found in this PDB file.');
    const bonds = [];
    for (const key of explicitBondSerials) {
      const [left, right] = key.split(':').map(Number);
      const a = serialMap.get(`*|${left}`);
      const b = serialMap.get(`*|${right}`);
      if (a != null && b != null) bonds.push([a, b]);
    }
    inferBonds(atoms, bonds);
    return finalizeStructure({
      format: 'pdb', atoms, bonds, assemblies: parsePdbAssemblies(lines), diagnostics,
      entityDefinitions: new Map(), instanceDefinitions: new Map()
    });
  }

  function parsePdbAssemblies(lines) {
    const assemblies = new Map();
    const activeGroups = new Map();
    let activeAssemblyIds = [];
    const ensureAssembly = id => {
      if (!assemblies.has(id)) assemblies.set(id, {
        id,
        details: 'PDB REMARK 350 biological assembly',
        methodDetails: 'PDB REMARK 350',
        oligomericDetails: '',
        oligomericCount: null,
        generators: [],
        _operators: new Map()
      });
      return assemblies.get(id);
    };

    for (const line of lines) {
      if (!/^REMARK 350\b/.test(line)) continue;
      const body = line.slice(10).trim();
      const biomolecule = body.match(/^BIOMOLECULE:\s*(.+)$/i);
      if (biomolecule) {
        activeAssemblyIds = biomolecule[1].split(',').map(id => id.trim()).filter(Boolean);
        for (const id of activeAssemblyIds) ensureAssembly(id);
        continue;
      }
      const oligomer = body.match(/^(?:AUTHOR|SOFTWARE) DETERMINED BIOLOGICAL UNIT:\s*(.+)$/i);
      if (oligomer) {
        const details = oligomer[1].trim();
        for (const id of activeAssemblyIds) {
          const assembly = ensureAssembly(id);
          assembly.oligomericDetails = details.toLowerCase();
          assembly.oligomericCount = oligomericCount(details);
        }
        continue;
      }
      const chains = body.match(/^(?:APPLY THE FOLLOWING TO|AND) CHAINS:\s*(.*)$/i);
      if (chains) {
        const asymIds = chains[1].split(',').map(id => id.trim()).filter(id => id && id.toUpperCase() !== 'NULL');
        const append = /^AND CHAINS:/i.test(body);
        for (const id of activeAssemblyIds) {
          const assembly = ensureAssembly(id);
          let group = append ? activeGroups.get(id) : null;
          if (!group) {
            group = { asymIds: [], operatorIds: [] };
            assembly.generators.push(group);
            activeGroups.set(id, group);
          }
          for (const asymId of asymIds) if (!group.asymIds.includes(asymId)) group.asymIds.push(asymId);
        }
        continue;
      }
      const biomt = body.match(/^BIOMT([123])\s+(\S+)\s+([-+0-9.Ee]+)\s+([-+0-9.Ee]+)\s+([-+0-9.Ee]+)\s+([-+0-9.Ee]+)/i);
      if (!biomt) continue;
      const rowIndex = Number(biomt[1]) - 1;
      const operatorId = biomt[2];
      const row = biomt.slice(3, 7).map(Number);
      if (!row.every(Number.isFinite)) continue;
      for (const id of activeAssemblyIds) {
        const assembly = ensureAssembly(id);
        let group = activeGroups.get(id);
        if (!group) {
          group = { asymIds: [], operatorIds: [] };
          assembly.generators.push(group);
          activeGroups.set(id, group);
        }
        if (!group.operatorIds.includes(operatorId)) group.operatorIds.push(operatorId);
        if (!assembly._operators.has(operatorId)) {
          assembly._operators.set(operatorId, {
            id: operatorId, type: 'PDB BIOMT operation', name: '', matrix: identityMatrix()
          });
        }
        assembly._operators.get(operatorId).matrix[rowIndex] = [...row];
      }
    }

    return [...assemblies.values()].map(assembly => {
      const generators = assembly.generators.map(group => {
        const operators = group.operatorIds.map(id => assembly._operators.get(id)).filter(Boolean);
        return {
          asymIds: group.asymIds,
          operatorExpression: group.operatorIds.join(','),
          operatorIds: [...group.operatorIds],
          operatorSequences: group.operatorIds.map(id => [id]),
          operators,
          transforms: operators.map(operator => ({
            id: operator.id, operatorIds: [operator.id], matrix: operator.matrix.map(row => [...row])
          }))
        };
      });
      const { _operators, ...normalized } = assembly;
      return { ...normalized, generators };
    });
  }

  function oligomericCount(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/ic$/, '');
    return {
      monomer: 1, dimer: 2, trimer: 3, tetramer: 4, pentamer: 5,
      hexamer: 6, heptamer: 7, octamer: 8, nonamer: 9, decamer: 10
    }[normalized] || null;
  }

  function tokenizeMmcif(value) {
    return tokenizeMmcifDetailed(value).map(token => token.value);
  }

  function tokenizeMmcifDetailed(value) {
    const text = String(value || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const tokens = [];
    let index = 0;
    while (index < text.length) {
      const character = text[index];
      if (/\s/.test(character)) {
        index += 1;
        continue;
      }
      if (character === '#') {
        const end = text.indexOf('\n', index);
        index = end < 0 ? text.length : end + 1;
        continue;
      }
      if (character === ';' && (index === 0 || text[index - 1] === '\n')) {
        const start = index + 1;
        const end = text.indexOf('\n;', start);
        if (end < 0) throw new Error('Unterminated semicolon-delimited value in mmCIF input.');
        tokens.push({ value: text.slice(start, end), quoted: true });
        index = end + 2;
        while (index < text.length && text[index] !== '\n') index += 1;
        continue;
      }
      if (character === "'" || character === '"') {
        const quote = character;
        const start = ++index;
        while (index < text.length) {
          if (text[index] === quote && (index + 1 === text.length || /\s/.test(text[index + 1]))) break;
          index += 1;
        }
        if (index >= text.length) throw new Error('Unterminated quoted value in mmCIF input.');
        tokens.push({ value: text.slice(start, index), quoted: true });
        index += 1;
        continue;
      }
      const start = index;
      while (index < text.length && !/\s/.test(text[index])) index += 1;
      tokens.push({ value: text.slice(start, index), quoted: false });
    }
    return tokens;
  }

  function parseMmcifDocument(value) {
    const tokens = tokenizeMmcifDetailed(value);
    const blocks = [];
    let block = null;
    const ensureBlock = () => {
      if (!block) {
        block = { name: '', categories: Object.create(null), warnings: [] };
        blocks.push(block);
      }
      return block;
    };
    let index = 0;
    while (index < tokens.length) {
      const token = tokens[index];
      const lower = token.value.toLowerCase();
      if (!token.quoted && lower.startsWith('data_')) {
        block = { name: token.value.slice(5), categories: Object.create(null), warnings: [] };
        blocks.push(block);
        index += 1;
        continue;
      }
      if (!token.quoted && lower === 'loop_') {
        const target = ensureBlock();
        index += 1;
        const tags = [];
        while (index < tokens.length && !tokens[index].quoted && tokens[index].value.startsWith('_')) {
          tags.push(parseCifTag(tokens[index].value));
          index += 1;
        }
        if (!tags.length) {
          target.warnings.push('An mmCIF loop had no data names.');
          continue;
        }
        const values = [];
        while (index < tokens.length && !isCifControl(tokens[index])
          && !(!tokens[index].quoted && tokens[index].value.startsWith('_'))) {
          values.push(tokens[index].value);
          index += 1;
        }
        const rowCount = Math.floor(values.length / tags.length);
        if (values.length % tags.length) target.warnings.push(`Loop ${tags[0].category} has an incomplete final row.`);
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
          const rowsByCategory = new Map();
          for (let column = 0; column < tags.length; column += 1) {
            const tag = tags[column];
            if (!rowsByCategory.has(tag.category)) rowsByCategory.set(tag.category, {});
            rowsByCategory.get(tag.category)[tag.item] = values[rowIndex * tags.length + column];
          }
          for (const [category, row] of rowsByCategory) {
            target.categories[category] ||= [];
            target.categories[category].push(row);
          }
        }
        continue;
      }
      if (!token.quoted && token.value.startsWith('_')) {
        const target = ensureBlock();
        const tag = parseCifTag(token.value);
        const next = tokens[index + 1];
        if (!next || isCifControl(next) || (!next.quoted && next.value.startsWith('_'))) {
          target.warnings.push(`Data name ${token.value} has no value.`);
          index += 1;
          continue;
        }
        target.categories[tag.category] ||= [{}];
        target.categories[tag.category][0][tag.item] = next.value;
        index += 2;
        continue;
      }
      index += 1;
    }
    return { blocks, tokens: tokens.length };
  }

  function parseCifTag(value) {
    const normalized = String(value).slice(1).toLowerCase();
    const dot = normalized.indexOf('.');
    if (dot < 1 || dot === normalized.length - 1) {
      return { category: normalized, item: 'value' };
    }
    return { category: normalized.slice(0, dot), item: normalized.slice(dot + 1) };
  }

  function isCifControl(token) {
    if (!token || token.quoted) return false;
    const lower = token.value.toLowerCase();
    return lower === 'loop_' || lower === 'stop_' || lower === 'global_'
      || lower.startsWith('data_') || lower.startsWith('save_');
  }

  function cifValue(value) {
    if (value == null || value === '.' || value === '?') return null;
    return String(value);
  }

  function cifNumber(value, fallback = null) {
    const normalized = cifValue(value);
    if (normalized == null) return fallback;
    const number = Number(normalized.replace(/\([0-9]+\)$/, ''));
    return Number.isFinite(number) ? number : fallback;
  }

  function parseMmcif(value) {
    const document = parseMmcifDocument(value);
    const block = document.blocks.find(candidate => candidate.categories.atom_site?.length)
      || document.blocks[0];
    if (!block) throw new Error('The mmCIF input does not contain a data block.');
    const atomRows = block.categories.atom_site || [];
    const atoms = [];
    const diagnostics = {
      coordinateLines: atomRows.length,
      skippedCoordinateLines: 0,
      malformedCoordinateLines: 0,
      malformedLineNumbers: [],
      parserWarnings: [...block.warnings]
    };
    for (let rowIndex = 0; rowIndex < atomRows.length; rowIndex += 1) {
      const row = atomRows[rowIndex];
      const x = cifNumber(row.cartn_x);
      const y = cifNumber(row.cartn_y);
      const z = cifNumber(row.cartn_z);
      if (![x, y, z].every(Number.isFinite)) {
        diagnostics.skippedCoordinateLines += 1;
        diagnostics.malformedCoordinateLines += 1;
        if (diagnostics.malformedLineNumbers.length < 20) diagnostics.malformedLineNumbers.push(rowIndex + 1);
        continue;
      }
      const labelAtomId = cifValue(row.label_atom_id) || cifValue(row.auth_atom_id) || 'X';
      const labelCompId = cifValue(row.label_comp_id) || cifValue(row.auth_comp_id) || 'UNK';
      const labelAsymId = cifValue(row.label_asym_id);
      const authAsymId = cifValue(row.auth_asym_id);
      const labelSeqId = cifValue(row.label_seq_id);
      const authSeqId = cifValue(row.auth_seq_id);
      const model = cifNumber(row.pdbx_pdb_model_num, 1) || 1;
      const serialValue = cifValue(row.id);
      const numericSerial = Number(serialValue);
      const legacyResidueNumber = cifNumber(authSeqId, cifNumber(labelSeqId, 0)) || 0;
      const alternateLocation = cifValue(row.label_alt_id) || cifValue(row.auth_alt_id) || '';
      const atom = {
        index: atoms.length,
        serial: Number.isFinite(numericSerial) ? numericSerial : atoms.length + 1,
        name: cifValue(row.auth_atom_id) || labelAtomId,
        altLoc: alternateLocation,
        resn: cifValue(row.auth_comp_id) || labelCompId,
        chain: authAsymId || labelAsymId || '_',
        resi: legacyResidueNumber,
        icode: cifValue(row.pdbx_pdb_ins_code) || '',
        x, y, z,
        occupancy: cifNumber(row.occupancy, 0) || 0,
        bfactor: cifNumber(row.b_iso_or_equiv, 0) || 0,
        element: inferElement(labelAtomId, cifValue(row.type_symbol)),
        het: String(row.group_pdb || '').toUpperCase() === 'HETATM',
        model,
        sourceFormat: 'mmcif',
        atomSiteId: serialValue,
        labelEntityId: cifValue(row.label_entity_id),
        labelAsymId,
        labelSeqId,
        labelCompId,
        labelAtomId,
        labelAltId: alternateLocation,
        authAsymId,
        authSeqId,
        authCompId: cifValue(row.auth_comp_id),
        authAtomId: cifValue(row.auth_atom_id),
        identityProvenance: 'mmcif-atom-site'
      };
      if (atoms.length >= MAX_ATOMS) throw new Error(`The structure exceeds the ${MAX_ATOMS.toLocaleString()} atom safety limit.`);
      atoms.push(atom);
    }
    if (!atoms.length) throw new Error('No valid atom_site Cartesian coordinates were found in this mmCIF file.');

    const entityDefinitions = mmcifEntityDefinitions(block.categories);
    const instanceDefinitions = mmcifInstanceDefinitions(block.categories);
    const bonds = mmcifExplicitBonds(block.categories, atoms);
    inferBonds(atoms, bonds);
    return finalizeStructure({
      format: 'mmcif', atoms, bonds,
      assemblies: mmcifAssemblies(block.categories),
      diagnostics, entityDefinitions, instanceDefinitions,
      dataBlock: block.name,
      cifCategories: block.categories
    });
  }

  function mmcifEntityDefinitions(categories) {
    const definitions = new Map();
    const polymerTypes = new Map((categories.entity_poly || []).map(row => [cifValue(row.entity_id), cifValue(row.type)]));
    for (const row of categories.entity || []) {
      const id = cifValue(row.id);
      if (!id) continue;
      const type = (cifValue(row.type) || '').toLowerCase();
      const polymerType = polymerTypes.get(id) || null;
      definitions.set(id, {
        sourceId: id,
        type,
        polymerType,
        description: cifValue(row.pdbx_description) || '',
        role: roleFromEntity(type, polymerType),
        subtype: subtypeFromPolymerType(polymerType),
        provenance: 'mmcif-entity'
      });
    }
    return definitions;
  }

  function mmcifInstanceDefinitions(categories) {
    const definitions = new Map();
    for (const row of categories.struct_asym || []) {
      const id = cifValue(row.id);
      if (!id) continue;
      definitions.set(id, {
        sourceId: id,
        entitySourceId: cifValue(row.entity_id),
        details: cifValue(row.details) || '',
        provenance: 'mmcif-struct-asym'
      });
    }
    return definitions;
  }

  function roleFromEntity(type, polymerType) {
    if (type === 'water') return 'solvent';
    if (type.includes('non-polymer')) return 'ligand';
    if (type.includes('polymer')) return 'polymer';
    if (type.includes('branched')) return 'ligand';
    if (polymerType) return 'polymer';
    return 'unknown';
  }

  function subtypeFromPolymerType(value) {
    const type = String(value || '').toLowerCase();
    if (type.includes('polypeptide')) return 'protein';
    if (type.includes('deoxyribo')) return 'dna';
    if (type.includes('ribonucleotide') || type.includes('polyribonucleotide')) return 'rna';
    if (type.includes('peptide nucleic')) return 'pna';
    if (type) return type;
    return 'other';
  }

  function classifyResidue(residueAtoms, definition) {
    const first = residueAtoms[0];
    const name = String(first?.labelCompId || first?.resn || '').toUpperCase();
    if (definition?.role && definition.role !== 'unknown') {
      if (definition.role === 'solvent') {
        return { role: 'solvent', subtype: WATER_NAMES.has(name) ? 'water' : (definition.subtype || 'other'), provenance: 'mmcif-entity' };
      }
      if (definition.role === 'ligand' && (WATER_NAMES.has(name) || definition.type === 'water')) {
        return { role: 'solvent', subtype: 'water', provenance: 'mmcif-entity' };
      }
      if (definition.role === 'ligand' && residueAtoms.length === 1 && ION_NAMES.has(name)) {
        return { role: 'ion', subtype: name, provenance: 'mmcif-entity' };
      }
      return { role: definition.role, subtype: definition.subtype || 'other', provenance: definition.provenance };
    }
    if (WATER_NAMES.has(name)) return { role: 'solvent', subtype: 'water', provenance: first?.sourceFormat === 'pdb' ? 'pdb-record' : 'name-fallback' };
    if (AMINO_ACIDS.has(name)) return { role: 'polymer', subtype: 'protein', provenance: first?.sourceFormat === 'pdb' ? 'pdb-record' : 'name-fallback' };
    if (NUCLEOTIDES.has(name)) {
      return { role: 'polymer', subtype: name.startsWith('D') || name === 'T' || name === 'THY' ? 'dna' : 'rna', provenance: first?.sourceFormat === 'pdb' ? 'pdb-record' : 'name-fallback' };
    }
    if (residueAtoms.length === 1 && ION_NAMES.has(name)) return { role: 'ion', subtype: name, provenance: 'name-fallback' };
    if (first?.het) return { role: 'ligand', subtype: name || 'other', provenance: first.sourceFormat === 'pdb' ? 'pdb-record' : 'name-fallback' };
    return { role: 'unknown', subtype: 'other', provenance: 'unknown' };
  }

  function finalizeStructure(input) {
    const atoms = input.atoms;
    const residues = [];
    const residueMap = new Map();
    for (const atom of atoms) {
      const sourceResidue = atom.sourceFormat === 'mmcif'
        ? `${atom.model}|${atom.labelAsymId || atom.authAsymId || '_'}|${atom.labelSeqId || atom.authSeqId || atom.resi}|${atom.icode}|${atom.labelCompId || atom.resn}`
        : `${atom.model}|${atom.authAsymId || '_'}|${atom.authSeqId}|${atom.icode}|${atom.authCompId || atom.resn}`;
      let residue = residueMap.get(sourceResidue);
      if (!residue) {
        residue = {
          index: residues.length,
          id: `residue-${residues.length + 1}`,
          modelNumber: atom.model,
          labelAsymId: atom.labelAsymId,
          labelSeqId: atom.labelSeqId,
          labelCompId: atom.labelCompId,
          authAsymId: atom.authAsymId,
          authSeqId: atom.authSeqId,
          authCompId: atom.authCompId,
          insertionCode: atom.icode,
          atomIndices: []
        };
        residueMap.set(sourceResidue, residue);
        residues.push(residue);
      }
      residue.atomIndices.push(atom.index);
      atom.residueIndex = residue.index;
    }

    const entityKeyByResidue = inferEntityKeys(input, residues, atoms);
    const entityMap = new Map();
    const entities = [];
    const instanceMap = new Map();
    const instances = [];

    for (const residue of residues) {
      const residueAtoms = residue.atomIndices.map(index => atoms[index]);
      const first = residueAtoms[0];
      const sourceEntityId = first.labelEntityId;
      const entityDefinition = sourceEntityId ? input.entityDefinitions.get(sourceEntityId) : null;
      const classification = classifyResidue(residueAtoms, entityDefinition);
      const entityKey = entityKeyByResidue.get(residue.index);
      let entity = entityMap.get(entityKey);
      if (!entity) {
        entity = {
          index: entities.length,
          id: sourceEntityId || `pdb-entity-${entities.length + 1}`,
          sourceId: sourceEntityId,
          type: entityDefinition?.type || classification.role,
          polymerType: entityDefinition?.polymerType || null,
          description: entityDefinition?.description || '',
          role: classification.role,
          subtype: classification.subtype,
          classificationProvenance: classification.provenance,
          residueIndices: [],
          instanceIndices: []
        };
        entityMap.set(entityKey, entity);
        entities.push(entity);
      }

      const instanceKey = inferInstanceKey(first, classification);
      let instance = instanceMap.get(instanceKey);
      if (!instance) {
        const definition = first.labelAsymId ? input.instanceDefinitions.get(first.labelAsymId) : null;
        instance = {
          index: instances.length,
          id: first.labelAsymId || `pdb-instance-${instances.length + 1}`,
          sourceId: first.labelAsymId,
          entityIndex: entity.index,
          labelAsymId: first.labelAsymId,
          authAsymIds: [],
          details: definition?.details || '',
          role: classification.role,
          subtype: classification.subtype,
          identityProvenance: definition?.provenance || 'pdb-inferred',
          residueIndices: []
        };
        instanceMap.set(instanceKey, instance);
        instances.push(instance);
        entity.instanceIndices.push(instance.index);
      }
      const authorChain = first.authAsymId || first.chain;
      if (authorChain && !instance.authAsymIds.includes(authorChain)) instance.authAsymIds.push(authorChain);
      residue.entityIndex = entity.index;
      residue.instanceIndex = instance.index;
      residue.role = classification.role;
      residue.subtype = classification.subtype;
      residue.classificationProvenance = classification.provenance;
      entity.residueIndices.push(residue.index);
      instance.residueIndices.push(residue.index);
      for (const atom of residueAtoms) {
        atom.entityIndex = entity.index;
        atom.instanceIndex = instance.index;
        atom.entityId = entity.id;
        atom.instanceId = instance.id;
        atom.role = classification.role;
        atom.subtype = classification.subtype;
        atom.classificationProvenance = classification.provenance;
        if (!atom.labelEntityId) atom.labelEntityId = entity.id;
        if (!atom.labelAsymId) atom.labelAsymId = instance.id;
        if (!atom.labelSeqId && classification.role === 'polymer') atom.labelSeqId = String(residue.index + 1);
      }
    }

    const coordinateSets = [...new Set(atoms.map(atom => atom.model))].sort((a, b) => a - b).map(modelNumber => ({
      modelNumber,
      atomIndices: atoms.filter(atom => atom.model === modelNumber).map(atom => atom.index)
    }));
    const components = connectedComponents(atoms, input.bonds);
    const assemblies = expandAssemblyInstances(input.assemblies || [], instances);
    const assemblyInstances = assemblies.flatMap((assembly, assemblyIndex) =>
      assembly.instances.map(instance => ({ ...instance, assemblyIndex }))
    );
    const indexes = buildIndexes(atoms, residues, instances, entities);
    const chains = [...new Set(atoms.map(atom => atom.chain))];
    return {
      format: input.format,
      source: { format: input.format, dataBlock: input.dataBlock || null },
      atoms,
      bonds: input.bonds,
      chains,
      topology: { atoms, residues, instances, entities, bonds: input.bonds, connectedComponents: components },
      coordinateSets,
      assemblies,
      assemblyInstances,
      classifications: residues.map(residue => ({
        residueIndex: residue.index,
        role: residue.role,
        subtype: residue.subtype,
        provenance: residue.classificationProvenance
      })),
      indexes,
      diagnostics: input.diagnostics,
      cifCategories: input.cifCategories || null
    };
  }

  function inferEntityKeys(input, residues, atoms) {
    const keys = new Map();
    const polymerSequences = new Map();
    if (input.format === 'pdb') {
      for (const residue of residues) {
        const first = atoms[residue.atomIndices[0]];
        const classification = classifyResidue(residue.atomIndices.map(index => atoms[index]), null);
        if (classification.role !== 'polymer') continue;
        const chainKey = first.authAsymId || '_';
        if (!polymerSequences.has(chainKey)) polymerSequences.set(chainKey, []);
        polymerSequences.get(chainKey).push(first.authCompId || first.resn);
      }
    }
    for (const residue of residues) {
      const first = atoms[residue.atomIndices[0]];
      if (first.labelEntityId) {
        keys.set(residue.index, `mmcif:${first.labelEntityId}`);
        continue;
      }
      const classification = classifyResidue(residue.atomIndices.map(index => atoms[index]), null);
      if (classification.role === 'polymer') {
        const sequence = (polymerSequences.get(first.authAsymId || '_') || []).join('-');
        keys.set(residue.index, `pdb:polymer:${classification.subtype}:${sequence}`);
      } else {
        keys.set(residue.index, `pdb:${classification.role}:${first.authCompId || first.resn}`);
      }
    }
    return keys;
  }

  function inferInstanceKey(atom, classification) {
    if (atom.labelAsymId) return `mmcif:${atom.labelAsymId}`;
    if (classification.role === 'polymer') return `pdb:polymer:${atom.authAsymId || '_'}`;
    return `pdb:${classification.role}:${atom.authAsymId || '_'}:${atom.authSeqId}:${atom.icode}:${atom.authCompId || atom.resn}`;
  }

  function buildIndexes(atoms, residues, instances, entities) {
    const atomSite = new Map();
    const labelAtom = new Map();
    const authorAtom = new Map();
    for (const atom of atoms) {
      if (atom.atomSiteId != null) atomSite.set(`${atom.model}|${atom.atomSiteId}`, atom.index);
      labelAtom.set(labelIdentityKey(atom), atom.index);
      authorAtom.set(authorIdentityKey(atom), atom.index);
    }
    return {
      atomSite,
      labelAtom,
      authorAtom,
      residuesById: new Map(residues.map(residue => [residue.id, residue.index])),
      instancesById: new Map(instances.map(instance => [instance.id, instance.index])),
      entitiesById: new Map(entities.map(entity => [entity.id, entity.index]))
    };
  }

  function labelIdentityKey(atom) {
    return [atom.model, atom.labelAsymId, atom.labelSeqId, atom.labelCompId, atom.labelAtomId, atom.labelAltId || ''].join('|');
  }

  function authorIdentityKey(atom) {
    return [atom.model, atom.authAsymId, atom.authSeqId, atom.icode || '', atom.authCompId, atom.authAtomId, atom.altLoc || ''].join('|');
  }

  function connectedComponents(atoms, bonds) {
    const parent = atoms.map((_, index) => index);
    const find = index => {
      let current = index;
      while (parent[current] !== current) {
        parent[current] = parent[parent[current]];
        current = parent[current];
      }
      return current;
    };
    const join = (left, right) => {
      const a = find(left);
      const b = find(right);
      if (a !== b) parent[b] = a;
    };
    for (const [left, right] of bonds) join(left, right);
    const groups = new Map();
    for (const atom of atoms) {
      const root = find(atom.index);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(atom.index);
    }
    const components = [...groups.values()].map((atomIndices, index) => ({ index, id: `component-${index + 1}`, atomIndices }));
    for (const component of components) {
      for (const atomIndex of component.atomIndices) atoms[atomIndex].connectedComponentIndex = component.index;
    }
    return components;
  }

  function mmcifExplicitBonds(categories, atoms) {
    const bonds = [];
    const existing = new Set();
    for (const row of categories.struct_conn || []) {
      const left = findStructConnAtom(atoms, row, 'ptnr1');
      const right = findStructConnAtom(atoms, row, 'ptnr2');
      if (left == null || right == null || left === right) continue;
      const key = left < right ? `${left}:${right}` : `${right}:${left}`;
      if (!existing.has(key)) {
        existing.add(key);
        bonds.push([left, right]);
      }
    }
    return bonds;
  }

  function findStructConnAtom(atoms, row, prefix) {
    const labelAsymId = cifValue(row[`${prefix}_label_asym_id`]);
    const labelSeqId = cifValue(row[`${prefix}_label_seq_id`]);
    const labelCompId = cifValue(row[`${prefix}_label_comp_id`]);
    const labelAtomId = cifValue(row[`${prefix}_label_atom_id`]);
    const authAsymId = cifValue(row[`${prefix}_auth_asym_id`]);
    const authSeqId = cifValue(row[`${prefix}_auth_seq_id`]);
    return atoms.find(atom =>
      (labelAsymId == null || atom.labelAsymId === labelAsymId)
      && (labelSeqId == null || atom.labelSeqId === labelSeqId)
      && (labelCompId == null || atom.labelCompId === labelCompId)
      && (labelAtomId == null || atom.labelAtomId === labelAtomId)
      && (authAsymId == null || atom.authAsymId === authAsymId)
      && (authSeqId == null || atom.authSeqId === authSeqId)
    )?.index;
  }

  function mmcifAssemblies(categories) {
    const operatorMap = new Map();
    for (const row of categories.pdbx_struct_oper_list || []) {
      const id = cifValue(row.id);
      if (!id) continue;
      operatorMap.set(id, {
        id,
        type: cifValue(row.type) || '',
        name: cifValue(row.name) || '',
        matrix: [
          [cifNumber(row['matrix[1][1]'], 1), cifNumber(row['matrix[1][2]'], 0), cifNumber(row['matrix[1][3]'], 0), cifNumber(row['vector[1]'], 0)],
          [cifNumber(row['matrix[2][1]'], 0), cifNumber(row['matrix[2][2]'], 1), cifNumber(row['matrix[2][3]'], 0), cifNumber(row['vector[2]'], 0)],
          [cifNumber(row['matrix[3][1]'], 0), cifNumber(row['matrix[3][2]'], 0), cifNumber(row['matrix[3][3]'], 1), cifNumber(row['vector[3]'], 0)],
          [0, 0, 0, 1]
        ]
      });
    }
    const details = new Map((categories.pdbx_struct_assembly || []).map(row => [cifValue(row.id), row]));
    const assemblyMap = new Map();
    for (const row of categories.pdbx_struct_assembly_gen || []) {
      const id = cifValue(row.assembly_id);
      if (!id) continue;
      if (!assemblyMap.has(id)) {
        const detail = details.get(id) || {};
        assemblyMap.set(id, {
          id,
          details: cifValue(detail.details) || '',
          methodDetails: cifValue(detail.method_details) || '',
          oligomericDetails: cifValue(detail.oligomeric_details) || '',
          oligomericCount: cifNumber(detail.oligomeric_count),
          generators: []
        });
      }
      const operatorExpression = cifValue(row.oper_expression) || '';
      const operatorSequences = expandOperatorExpression(operatorExpression);
      const operatorIds = [...new Set(operatorSequences.flat())];
      assemblyMap.get(id).generators.push({
        asymIds: (cifValue(row.asym_id_list) || '').split(',').map(item => item.trim()).filter(Boolean),
        operatorExpression,
        operatorIds,
        operatorSequences,
        operators: operatorIds.map(operatorId => operatorMap.get(operatorId)).filter(Boolean),
        transforms: operatorSequences.map((sequence, index) => ({
          id: sequence.join('x') || String(index + 1),
          operatorIds: sequence,
          matrix: composeOperatorSequence(sequence, operatorMap)
        })).filter(transform => transform.matrix)
      });
    }
    return [...assemblyMap.values()];
  }

  function expandOperatorExpression(value) {
    const expression = String(value || '').trim();
    if (!expression) return [];
    const groups = [];
    for (const match of expression.matchAll(/\(([^()]*)\)/g)) groups.push(expandOperatorGroup(match[1]));
    if (!groups.length) groups.push(expandOperatorGroup(expression));
    if (groups.some(group => !group.length)) return [];
    return groups.reduce((combinations, group) =>
      combinations.flatMap(sequence => group.map(operatorId => [...sequence, operatorId])), [[]]);
  }

  function expandOperatorGroup(value) {
    const ids = [];
    for (const item of String(value || '').split(',')) {
      const part = item.trim();
      const range = part.match(/^(\d+)-(\d+)$/);
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        const step = start <= end ? 1 : -1;
        for (let number = start; number !== end + step; number += step) ids.push(String(number));
      } else if (part) ids.push(part);
    }
    return ids;
  }

  function composeOperatorSequence(sequence, operatorMap) {
    let matrix = identityMatrix();
    for (const operatorId of sequence) {
      const operator = operatorMap.get(operatorId);
      if (!operator) return null;
      matrix = multiplyMatrices(matrix, operator.matrix);
    }
    return matrix;
  }

  function identityMatrix() {
    return [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];
  }

  function multiplyMatrices(left, right) {
    return left.map((row, rowIndex) => row.map((_, columnIndex) =>
      row.reduce((sum, value, index) => sum + value * right[index][columnIndex], 0)
    ));
  }

  function expandAssemblyInstances(assemblies, instances) {
    const instanceByLabelAsymId = new Map(instances
      .filter(instance => instance.labelAsymId)
      .map(instance => [instance.labelAsymId, instance]));
    const instancesByAuthorChain = new Map();
    for (const instance of instances) for (const authorChain of instance.authAsymIds) {
      if (!instancesByAuthorChain.has(authorChain)) instancesByAuthorChain.set(authorChain, []);
      instancesByAuthorChain.get(authorChain).push(instance);
    }
    return assemblies.map(assembly => {
      const expanded = [];
      for (const [generatorIndex, generator] of assembly.generators.entries()) {
        for (const asymId of generator.asymIds) {
          const labeled = instanceByLabelAsymId.get(asymId);
          const bases = labeled ? [labeled] : (instancesByAuthorChain.get(asymId) || []);
          for (const base of bases) for (const transform of generator.transforms || []) {
              expanded.push({
                index: expanded.length,
                id: `${assembly.id}:${generatorIndex}:${base.id}:${transform.id}`,
                assemblyId: assembly.id,
                generatorIndex,
                baseInstanceIndex: base.index,
                baseInstanceId: base.id,
                labelAsymId: base.labelAsymId,
                operatorIds: [...transform.operatorIds],
                transform: transform.matrix.map(row => [...row])
              });
          }
        }
      }
      return { ...assembly, instances: expanded };
    });
  }

  function inferBonds(atoms, bonds) {
    const existing = new Set(bonds.map(([left, right]) => left < right ? `${left}:${right}` : `${right}:${left}`));
    const cellSize = 2.6;
    const cells = new Map();
    const cellKey = (x, y, z) => `${x}|${y}|${z}`;
    for (const atom of atoms) {
      const cell = [Math.floor(atom.x / cellSize), Math.floor(atom.y / cellSize), Math.floor(atom.z / cellSize)];
      atom._bondCell = cell;
      const key = cellKey(...cell);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(atom.index);
    }
    for (const atom of atoms) {
      const [cellX, cellY, cellZ] = atom._bondCell;
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
        const nearby = cells.get(cellKey(cellX + dx, cellY + dy, cellZ + dz));
        if (!nearby) continue;
        for (const otherIndex of nearby) {
          if (otherIndex <= atom.index) continue;
          const other = atoms[otherIndex];
          if (atom.model !== other.model) continue;
          if (atom.labelAsymId && other.labelAsymId && atom.labelAsymId !== other.labelAsymId) continue;
          if (atom.sourceFormat === 'pdb' && other.sourceFormat === 'pdb'
            && atom.authAsymId && other.authAsymId && atom.authAsymId !== other.authAsymId) continue;
          const x = atom.x - other.x;
          const y = atom.y - other.y;
          const z = atom.z - other.z;
          const distanceSquared = x * x + y * y + z * z;
          const maximum = (COVALENT_RADII[atom.element] || .77) + (COVALENT_RADII[other.element] || .77) + .46;
          if (distanceSquared < .16 || distanceSquared > maximum * maximum) continue;
          const key = atom.index < otherIndex ? `${atom.index}:${otherIndex}` : `${otherIndex}:${atom.index}`;
          if (!existing.has(key)) {
            existing.add(key);
            bonds.push([atom.index, otherIndex]);
          }
        }
      }
      delete atom._bondCell;
    }
  }

  function spatialIndex(atoms, cellSizeValue) {
    if (!Array.isArray(atoms)) return { cellSize: 1, cells: new Map() };
    const cellSize = Math.max(.1, Number(cellSizeValue) || 1);
    let indexes = spatialIndexCache.get(atoms);
    if (!indexes) {
      indexes = new Map();
      spatialIndexCache.set(atoms, indexes);
    }
    const key = cellSize.toFixed(3);
    if (indexes.has(key)) return indexes.get(key);
    const cells = new Map();
    for (const atom of atoms) {
      const x = Math.floor(atom.x / cellSize);
      const y = Math.floor(atom.y / cellSize);
      const z = Math.floor(atom.z / cellSize);
      const cell = `${atom.model}|${x}|${y}|${z}`;
      if (!cells.has(cell)) cells.set(cell, []);
      cells.get(cell).push(atom.index);
    }
    const index = { cellSize, cells };
    indexes.set(key, index);
    return index;
  }

  function finiteOr(value, fallback) {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : fallback;
  }

  window.MolhtmlStructure = Object.freeze({
    normalizeStructureFormat,
    detectStructureFormat,
    parseStructure,
    parsePDBCoordinates,
    parseMmcif,
    parseMmcifDocument,
    tokenizeMmcif,
    inferElement,
    labelIdentityKey,
    authorIdentityKey,
    spatialIndex
  });
})();
