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
  const MEASUREMENT_ATOM_COUNTS = Object.freeze({ distance: 2, angle: 3, dihedral: 4 });
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

  function parsePDB(text) {
    const atoms = [];
    const explicitBonds = new Set();
    const serialMap = new Map();
    let model = 1;
    const lines = String(text || '').replace(/\r/g, '').split('\n');

    for (const line of lines) {
      const record = line.slice(0, 6).trim().toUpperCase();
      if (record === 'MODEL') {
        model = Number.parseInt(line.slice(10, 14), 10) || model;
        continue;
      }
      if (record === 'ATOM' || record === 'HETATM') {
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
    return { atoms, bonds, chains: [...new Set(atoms.map(a => a.chain))] };
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
      camera: validCamera(doc.scene.camera) ? { view: doc.scene.camera.view.map(Number) } : { view: null }
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

  function validCamera(camera) {
    return Array.isArray(camera?.view) && camera.view.length === 8 && camera.view.every(Number.isFinite);
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
    ELEMENT_COLORS, CHAIN_COLORS, parsePDB, normalizeDocument, selectorForAtom,
    atomMatchesSelector, atomIdentity, atomLabel, colorForAtom, isWater, vdwRadius, uid,
    MEASUREMENT_ATOM_COUNTS, normalizeMeasurements, measurementAtoms, measurementValue,
    formatMeasurementValue,
    residueDescriptor, buildStructureHierarchy, representativeAtom
  };
})();
