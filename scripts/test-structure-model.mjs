import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = {};
await import('../src/structure.js');
await import('../src/model.js');
const Core = window.MolhtmlCore;
const Structure = window.MolhtmlStructure;

const [mmcif, pdb, sharedChainPdb, multiModelPdb, multiModelCif, authorStructConnCif, modifiedResiduePdb, multiParentModifiedCif, alternateConformerPdb, alternateConformerCif, conformanceCif, equivalentCif, malformedCif, pdbAssemblyText] = await Promise.all([
  readFile(new URL('../fixtures/7ril-identity.cif', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/mini-peptide.pdb', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/7ril-author-chain.pdb', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/multi-model.pdb', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/multi-model.cif', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/author-struct-conn.cif', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/modified-residue.pdb', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/multi-parent-modified.cif', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/alternate-conformers.pdb', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/alternate-conformers.cif', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/identity-conformance.cif', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/mini-peptide.cif', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/malformed.cif', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/pdb-assembly.pdb', import.meta.url), 'utf8')
]);

function assertNormalizedInvariants(structure) {
  const { atoms, residues, instances, entities, bonds, connectedComponents } = structure.topology;
  for (const [index, atom] of atoms.entries()) {
    assert.equal(atom.index, index);
    assert.ok(residues[atom.residueIndex]);
    assert.ok(instances[atom.instanceIndex]);
    assert.ok(entities[atom.entityIndex]);
    assert.ok(connectedComponents[atom.connectedComponentIndex]);
    assert.equal(residues[atom.residueIndex].instanceIndex, atom.instanceIndex);
    assert.equal(residues[atom.residueIndex].entityIndex, atom.entityIndex);
  }
  for (const [index, residue] of residues.entries()) {
    assert.equal(residue.index, index);
    assert.ok(instances[residue.instanceIndex]);
    assert.ok(entities[residue.entityIndex]);
    for (const atomIndex of residue.atomIndices) assert.equal(atoms[atomIndex].residueIndex, index);
  }
  for (const [index, instance] of instances.entries()) {
    assert.equal(instance.index, index);
    assert.ok(entities[instance.entityIndex]);
    for (const residueIndex of instance.residueIndices) assert.equal(residues[residueIndex].instanceIndex, index);
  }
  for (const [index, entity] of entities.entries()) {
    assert.equal(entity.index, index);
    for (const residueIndex of entity.residueIndices) assert.equal(residues[residueIndex].entityIndex, index);
    for (const instanceIndex of entity.instanceIndices) assert.equal(instances[instanceIndex].entityIndex, index);
  }
  for (const bond of bonds) {
    const [left, right] = bond.atomIndices;
    assert.ok(atoms[left]);
    assert.ok(atoms[right]);
    assert.notEqual(left, right);
    assert.ok(Number.isFinite(bond.order) && bond.order > 0);
    assert.ok(bond.provenance);
    assert.ok(bond.connectionType);
  }
  for (const [index, component] of connectedComponents.entries()) {
    assert.equal(component.index, index);
    for (const atomIndex of component.atomIndices) assert.equal(atoms[atomIndex].connectedComponentIndex, index);
  }
  for (const coordinateSet of structure.coordinateSets) {
    for (const atomIndex of coordinateSet.atomIndices) assert.equal(atoms[atomIndex].model, coordinateSet.modelNumber);
  }
  for (const assemblyInstance of structure.assemblyInstances) {
    assert.ok(instances[assemblyInstance.baseInstanceIndex]);
    assert.equal(assemblyInstance.transform.length, 4);
    assert.ok(assemblyInstance.transform.every(row => row.length === 4 && row.every(Number.isFinite)));
  }
}

assert.equal(Structure.detectStructureFormat(mmcif, 'pdb'), 'mmcif', 'content detection overrides a misleading hint');
assert.equal(Structure.detectStructureFormat(pdb, 'mmcif'), 'pdb', 'PDB content is detected independently of its extension');
assert.equal(Structure.inferElement(' CA ', ''), 'C', 'right-aligned PDB alpha carbon remains carbon');
assert.equal(Structure.inferElement('CA  ', ''), 'CA', 'left-aligned two-character PDB element remains calcium');
assert.equal(Structure.inferElement('1HG ', ''), 'H', 'leading-digit PDB hydrogen names infer hydrogen');
assert.equal(Structure.inferElement('HG11', ''), 'H', 'four-character side-chain hydrogen names remain hydrogen');
assert.equal(Structure.inferElement('HE2', ''), 'H', 'digit-suffixed hydrogen names are not treated as helium');
assert.equal(Structure.inferElement("HO2'", ''), 'H', 'nucleic-acid hydroxyl hydrogen names are not treated as holmium');
assert.equal(Structure.inferElement(' D  ', 'D'), 'H', 'explicit deuterium uses hydrogen chemistry');
assert.equal(Structure.inferElement(' T  ', 'T'), 'H', 'explicit tritium uses hydrogen chemistry');
assert.equal(Structure.inferElement('CL  ', ''), 'CL', 'two-character element names retain both characters');
assert.equal(Structure.inferElement('HG  ', ''), 'HG', 'properly aligned mercury remains mercury');
assert.equal(Structure.inferElement('HE  ', ''), 'HE', 'properly aligned helium remains helium');
assert.equal(Structure.inferElement(' CA ', 'ZN'), 'ZN', 'an explicit valid element takes precedence');

const parsed = Core.parseStructure(mmcif, 'mmcif');
assertNormalizedInvariants(parsed);
assert.equal(parsed.format, 'mmcif');
assert.equal(parsed.atoms.length, 12);
assert.equal(parsed.topology.residues.length, 6);
assert.equal(parsed.topology.instances.length, 4);
assert.equal(parsed.topology.entities.length, 4);
assert.equal(parsed.coordinateSets.length, 1);
assert.equal(parsed.assemblies.length, 1);
assert.deepEqual(Array.from(parsed.assemblies[0].generators[0].asymIds), ['A', 'B', 'C', 'D']);
assert.equal(parsed.assemblies[0].instances.length, 4, 'assembly instances reference base instances without copying topology');
assert.equal(parsed.assemblyInstances.length, 4);
assert.deepEqual(JSON.parse(JSON.stringify(parsed.assemblyInstances[0].transform)), [
  [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]
]);
assert.equal(Structure.spatialIndex(parsed.atoms, 4), Structure.spatialIndex(parsed.atoms, 4),
  'spatial indexes are built lazily and reused for the same atom array and cell size');
assert.equal(parsed.metadata.pdbId, '7RIL');
assert.equal(parsed.metadata.resolutionAngstroms[0], 1.8);
assert.match(parsed.metadata.title, /hairpin polyamide/i);

for (const atom of parsed.atoms) {
  assert.ok(Number.isInteger(atom.residueIndex), 'every atom has a residue index');
  assert.ok(Number.isInteger(atom.instanceIndex), 'every atom has an instance index');
  assert.ok(Number.isInteger(atom.entityIndex), 'every atom has an entity index');
  assert.ok(atom.instanceId, 'every atom has a stable instance id');
  assert.ok(atom.entityId, 'every atom has a stable entity id');
}

const dnaB = parsed.atoms.find(atom => atom.labelAsymId === 'B');
const ligand = parsed.atoms.find(atom => atom.labelAsymId === 'C');
assert.ok(dnaB && ligand);
assert.equal(dnaB.chain, 'B');
assert.equal(ligand.chain, 'B', '7RIL ligand retains author chain B');
assert.equal(dnaB.instanceId, 'B');
assert.equal(ligand.instanceId, 'C', 'label_asym_id keeps the ligand as a distinct molecular instance');
assert.equal(dnaB.entityId, '2');
assert.equal(ligand.entityId, '3');
assert.equal(dnaB.role, 'polymer');
assert.equal(dnaB.subtype, 'dna');
assert.equal(ligand.role, 'ligand');
assert.equal(ligand.classificationProvenance, 'mmcif-entity');

const structureId = 'structure-7ril';
const atomSelector = { kind: 'atom', ...Core.selectorForAtom(ligand, 'atom', structureId) };
const serializedSelector = JSON.parse(JSON.stringify(atomSelector));
const atomMatch = Core.matchSavedSelection(serializedSelector, parsed.atoms, structureId);
assert.equal(atomMatch.valid, true);
assert.equal(atomMatch.atomCount, 1);
assert.equal(atomMatch.atoms[0].atomSiteId, ligand.atomSiteId);

const instanceSelector = { kind: 'instance', ...Core.selectorForAtom(ligand, 'instance', structureId) };
const instanceMatch = Core.matchSavedSelection(instanceSelector, parsed.atoms, structureId);
assert.equal(instanceMatch.valid, true);
assert.equal(instanceMatch.atomCount, 2);
assert.ok(instanceMatch.atoms.every(atom => atom.labelAsymId === 'C'));

const entitySelector = { kind: 'entity', ...Core.selectorForAtom(ligand, 'entity', structureId) };
const entityMatch = Core.matchSavedSelection(entitySelector, parsed.atoms, structureId);
assert.equal(entityMatch.valid, true);
assert.equal(entityMatch.atomCount, 2);
assert.ok(entityMatch.atoms.every(atom => atom.labelEntityId === '3'));

const componentSelector = { kind: 'connected-component', ...Core.selectorForAtom(ligand, 'connected-component', structureId) };
const componentMatch = Core.matchSavedSelection(componentSelector, parsed.atoms, structureId);
assert.equal(componentMatch.valid, true);
assert.equal(componentMatch.atomCount, 2);
assert.ok(componentMatch.atoms.includes(ligand));

const fallbackIdentity = Core.matchSavedSelection({
  ...atomSelector,
  sourceIdentity: { ...atomSelector.sourceIdentity, atomSiteId: 'missing-atom-site' }
}, parsed.atoms, structureId);
assert.equal(fallbackIdentity.valid, true);
assert.equal(fallbackIdentity.atoms[0].atomSiteId, ligand.atomSiteId,
  'a stale atom-site id falls back to complete label identity');
const preferredAtomSite = Core.matchSavedSelection({
  ...atomSelector,
  sourceIdentity: { ...atomSelector.sourceIdentity, labelAsymId: 'incorrect-label-asym' }
}, parsed.atoms, structureId);
assert.equal(preferredAtomSite.valid, true);
assert.equal(preferredAtomSite.atoms[0].atomSiteId, ligand.atomSiteId,
  'an exact atom-site id takes priority over lower identity tiers');
const staleAuthorAlt = structuredClone(atomSelector);
delete staleAuthorAlt.sourceIdentity.atomSiteId;
staleAuthorAlt.sourceIdentity.authAltId = 'stale-alternate';
Object.assign(staleAuthorAlt, { chain: 'missing-chain', resi: -1, atom: 'missing-atom', serial: -1 });
const staleAuthorAltMatch = Core.matchSavedSelection(staleAuthorAlt, parsed.atoms, structureId);
assert.equal(staleAuthorAltMatch.valid, true);
assert.equal(staleAuthorAltMatch.atoms[0].atomSiteId, ligand.atomSiteId,
  'a stale author alternate cannot veto an otherwise unique higher-priority label match');
const staleLegacyIdentity = Core.matchSavedSelection({
  ...atomSelector,
  chain: 'missing-chain', resi: -1, atom: 'missing-atom', serial: -1
}, parsed.atoms, structureId);
assert.equal(staleLegacyIdentity.valid, true);
assert.equal(staleLegacyIdentity.atoms[0].atomSiteId, ligand.atomSiteId,
  'an exact source identity is not vetoed by stale redundant legacy fields');
const conflictingLowerTier = Core.matchSavedSelection({
  ...atomSelector,
  sourceIdentity: {
    ...atomSelector.sourceIdentity,
    labelAsymId: dnaB.labelAsymId,
    labelEntityId: dnaB.labelEntityId,
    labelSeqId: dnaB.labelSeqId,
    labelCompId: dnaB.labelCompId,
    labelAtomId: dnaB.labelAtomId
  }
}, parsed.atoms, structureId);
assert.equal(conflictingLowerTier.valid, true);
assert.equal(conflictingLowerTier.atoms[0].atomSiteId, ligand.atomSiteId,
  'the first globally successful identity tier wins even when lower tiers identify another atom');
const ambiguousPreferredTier = Core.matchSavedSelection({
  ...atomSelector,
  sourceIdentity: {
    modelNumber: ligand.model,
    labelAsymId: ligand.labelAsymId,
    authAsymId: ligand.authAsymId,
    authSeqId: ligand.authSeqId,
    authAtomId: ligand.authAtomId
  }
}, parsed.atoms, structureId);
assert.equal(ambiguousPreferredTier.valid, false);
assert.match(ambiguousPreferredTier.error, /ambiguous/i,
  'an ambiguous higher-priority tier is not narrowed by lower-priority identities or legacy fields');
const legacyFallback = Core.matchSavedSelection({
  ...atomSelector,
  sourceIdentity: {
    ...atomSelector.sourceIdentity,
    atomSiteId: 'missing-atom-site', labelAsymId: 'missing-instance', authAsymId: 'missing-chain'
  }
}, parsed.atoms, structureId);
assert.equal(legacyFallback.valid, true);
assert.equal(legacyFallback.atoms[0].atomSiteId, ligand.atomSiteId,
  'legacy identity is used only after every declared source-identity tier fails globally');
const unresolved = Core.matchSavedSelection({
  ...atomSelector,
  chain: 'missing-chain', resi: -1, atom: 'missing-atom', serial: -1,
  sourceIdentity: {
    ...atomSelector.sourceIdentity,
    atomSiteId: 'missing-atom-site', labelAsymId: 'missing-instance', authAsymId: 'missing-chain'
  }
}, parsed.atoms, structureId);
assert.equal(unresolved.valid, false);
assert.match(unresolved.error, /did not resolve/i, 'missing source identity is reported explicitly');
const unbound = Core.resolveUniqueAtomSelector(
  Object.fromEntries(Object.entries(atomSelector).filter(([key]) => key !== 'structureId')),
  parsed.atoms,
  structureId
);
assert.equal(unbound.valid, false);
assert.match(unbound.error, /missing structureId/i, 'persisted selectors cannot silently bind to the current structure');

const roleSelector = { kind: 'role', ...Core.selectorForAtom(ligand, 'role', structureId) };
const roleMatch = Core.matchSavedSelection(roleSelector, parsed.atoms, structureId);
assert.equal(roleMatch.valid, true);
assert.equal(roleMatch.atomCount, 4, 'both non-polymer entities are classified as ligands');

const colorDocument = { structure: { id: structureId }, scene: { colorMode: 'chain', customColors: [] } };
assert.equal(Core.colorForAtom(dnaB, colorDocument, parsed), Core.colorForAtom(ligand, colorDocument, parsed),
  'author-chain coloring remains literal and predictable');
colorDocument.scene.colorMode = 'instance';
assert.notEqual(Core.colorForAtom(dnaB, colorDocument, parsed), Core.colorForAtom(ligand, colorDocument, parsed),
  'molecular-instance coloring distinguishes a ligand sharing the author chain');
colorDocument.scene.colorMode = 'role';
assert.notEqual(Core.colorForAtom(dnaB, colorDocument, parsed), Core.colorForAtom(ligand, colorDocument, parsed),
  'role coloring distinguishes polymer from ligand');

const inferredPdb = Core.parseStructure(sharedChainPdb, 'pdb');
assertNormalizedInvariants(inferredPdb);
const inferredDna = inferredPdb.atoms.find(atom => !atom.het);
const inferredLigand = inferredPdb.atoms.find(atom => atom.het);
assert.equal(inferredDna.chain, inferredLigand.chain, 'legacy PDB preserves the shared author chain');
assert.notEqual(inferredDna.instanceId, inferredLigand.instanceId, 'PDB normalization infers distinct molecular instances');
assert.notEqual(inferredDna.entityId, inferredLigand.entityId, 'PDB normalization infers distinct entities');
assert.equal(inferredDna.role, 'polymer');
assert.equal(inferredLigand.role, 'ligand');
assert.equal(inferredLigand.classificationProvenance, 'pdb-record');

const multiModel = Core.parseStructure(multiModelPdb, 'pdb');
assertNormalizedInvariants(multiModel);
assert.equal(multiModel.coordinateSets.length, 2);
assert.deepEqual(Array.from(multiModel.coordinateSets, set => set.modelNumber), [1, 2]);
assert.equal(multiModel.atoms.length, 4);
assert.equal(multiModel.topology.instances.length, 1, 'coordinate models share one inferred molecular instance');
assert.deepEqual(JSON.parse(JSON.stringify(multiModel.bonds.map(bond => [bond.atomIndices, bond.order, bond.provenance]))),
  [[[0, 1], 1, 'pdb-conect'], [[2, 3], 1, 'pdb-conect']],
  'PDB CONECT records are resolved independently in every coordinate model');
const pdbResidueColorDocument = { structure: { id: 'multi-model-pdb' }, scene: { colorMode: 'residue', customColors: [] } };
assert.equal(Core.colorForAtom(multiModel.atoms[0], pdbResidueColorDocument, multiModel),
  Core.colorForAtom(multiModel.atoms[2], pdbResidueColorDocument, multiModel),
  'PDB residues also keep their colors across coordinate models');
const orderedPdbBonds = Core.parseStructure(multiModelPdb.replace('CONECT    1    2', 'CONECT    1    2    2'), 'pdb');
assert.deepEqual(Array.from(orderedPdbBonds.bonds, bond => bond.order), [2, 2],
  'repeated PDB CONECT targets preserve explicit bond order');

const multiModelMmcif = Core.parseStructure(multiModelCif, 'mmcif');
assertNormalizedInvariants(multiModelMmcif);
assert.deepEqual(Array.from(multiModelMmcif.coordinateSets, set => set.modelNumber), [1, 2]);
assert.deepEqual(JSON.parse(JSON.stringify(multiModelMmcif.bonds.map(bond => [bond.atomIndices, bond.order, bond.provenance]))),
  [[[0, 1], 2, 'mmcif-struct-conn'], [[2, 3], 2, 'mmcif-struct-conn']],
  'mmCIF struct_conn bond order is retained in every coordinate model');
const residueColorDocument = { structure: { id: 'multi-model' }, scene: { colorMode: 'residue', customColors: [] } };
assert.equal(Core.colorForAtom(multiModelMmcif.atoms[0], residueColorDocument, multiModelMmcif),
  Core.colorForAtom(multiModelMmcif.atoms[2], residueColorDocument, multiModelMmcif),
  'the same normalized residue keeps its color across coordinate models');
const modelSpecificConnection = Core.parseStructure(multiModelCif
  .replace('_struct_conn.pdbx_value_order',
    '_struct_conn.pdbx_ptnr1_PDB_model_num\n_struct_conn.pdbx_ptnr2_PDB_model_num\n_struct_conn.pdbx_value_order')
  .replace('ligand-link covale A LIG C1 A LIG C2 doub', 'ligand-link covale A LIG C1 A LIG C2 1 1 doub'), 'mmcif');
assert.equal(modelSpecificConnection.bonds.map(bond => bond.atomIndices.join(':')).join(','), '0:1',
  'struct_conn partner model numbers restrict explicit topology to the named coordinate model');
assert.ok(!modelSpecificConnection.diagnostics.parserWarnings.some(warning => /ambiguous or unresolved/i.test(warning)),
  'model-specific struct_conn rows do not emit false diagnostics for other coordinate models');
const crossModelConnection = Core.parseStructure(multiModelCif
  .replace('_struct_conn.pdbx_value_order',
    '_struct_conn.pdbx_ptnr1_PDB_model_num\n_struct_conn.pdbx_ptnr2_PDB_model_num\n_struct_conn.pdbx_value_order')
  .replace('ligand-link covale A LIG C1 A LIG C2 doub', 'ligand-link covale A LIG C1 A LIG C2 1 2 doub'), 'mmcif');
assert.equal(crossModelConnection.bonds.length, 0, 'cross-model struct_conn rows do not create base topology');
assert.equal(crossModelConnection.diagnostics.parserWarnings.filter(warning => /different coordinate models/i.test(warning)).length, 1,
  'unsupported cross-model struct_conn rows emit one explicit diagnostic');
for (const connectionType of ['disulf', 'modres', 'metalc']) {
  const connected = Core.parseStructure(multiModelCif.replace('covale', connectionType), 'mmcif');
  assert.deepEqual(JSON.parse(JSON.stringify(connected.bonds.map(bond => bond.atomIndices))), [[0, 1], [2, 3]],
    `mmCIF ${connectionType} connections contribute to chemical topology`);
}
for (const connectionType of ['hydrog', 'saltbr', 'mismat']) {
  const interactionOnly = Core.parseStructure(multiModelCif.replace('covale', connectionType), 'mmcif');
  assert.equal(interactionOnly.bonds.length, 0, `mmCIF ${connectionType} interactions are not chemical bonds`);
  assert.equal(interactionOnly.topology.connectedComponents.length, 4,
    `mmCIF ${connectionType} interactions do not merge connected components`);
}

const authorStructConn = Core.parseStructure(authorStructConnCif, 'mmcif');
assertNormalizedInvariants(authorStructConn);
assert.deepEqual(Array.from(authorStructConn.atoms, atom => atom.authAltId), ['A', 'B', 'A', 'B'],
  'author alternate-location identity is preserved separately');
assert.ok(authorStructConn.atoms.every(atom => atom.labelAltId == null),
  'missing label alternate-location identity remains missing');
assert.deepEqual(JSON.parse(JSON.stringify(authorStructConn.bonds)), [{
  atomIndices: [0, 2], order: 2, provenance: 'mmcif-struct-conn', connectionType: 'covale'
}], 'author-only struct_conn identity resolves exactly the named conformer pair and preserves order');
const authorAltSelector = Core.selectorForAtom(authorStructConn.atoms[0], 'atom', 'author-alt');
delete authorAltSelector.sourceIdentity.atomSiteId;
const authorAltResolution = Core.resolveUniqueAtomSelector(authorAltSelector, authorStructConn.atoms, 'author-alt');
assert.equal(authorAltResolution.valid, true, 'author alternate identity disambiguates label-identical conformers');
assert.equal(authorAltResolution.atom.index, 0);
const ambiguousStructConn = Core.parseStructure(authorStructConnCif
  .replaceAll('_struct_conn.ptnr1_auth_atom_id', '_struct_conn.ptnr1_ignored_atom_id')
  .replaceAll('_struct_conn.ptnr2_auth_atom_id', '_struct_conn.ptnr2_ignored_atom_id')
  .replaceAll('_struct_conn.pdbx_ptnr1_auth_alt_id', '_struct_conn.pdbx_ptnr1_ignored_alt_id')
  .replaceAll('_struct_conn.pdbx_ptnr2_auth_alt_id', '_struct_conn.pdbx_ptnr2_ignored_alt_id'), 'mmcif');
assert.equal(ambiguousStructConn.bonds.length, 0, 'ambiguous struct_conn identities never create Cartesian-product bonds');
assert.ok(ambiguousStructConn.diagnostics.parserWarnings.some(warning => /ambiguous or unresolved/i.test(warning)));
const symmetryStructConn = Core.parseStructure(
  authorStructConnCif
    .replace('1_555 1_555 doub', '1_555 2_555 doub')
    .replace('10.000 0.000 0.000', '1.300 0.000 0.000'),
  'mmcif'
);
assert.equal(symmetryStructConn.bonds.length, 0, 'symmetry-mate connections are excluded from base topology');
assert.equal(symmetryStructConn.topology.connectedComponents.length, 4,
  'symmetry-qualified atom pairs cannot be resurrected by distance inference');
assert.ok(symmetryStructConn.diagnostics.parserWarnings.some(warning => /symmetry mate/i.test(warning)),
  'unsupported symmetry-mate connections produce a parser diagnostic');
const ambiguousSymmetryStructConn = Core.parseStructure(alternateConformerCif.replace(
  'loop_\n_atom_site.group_PDB',
  `loop_
_struct_conn.id
_struct_conn.conn_type_id
_struct_conn.ptnr1_label_asym_id
_struct_conn.ptnr1_label_comp_id
_struct_conn.ptnr1_label_atom_id
_struct_conn.ptnr2_label_asym_id
_struct_conn.ptnr2_label_comp_id
_struct_conn.ptnr2_label_atom_id
_struct_conn.ptnr1_symmetry
_struct_conn.ptnr2_symmetry
ambiguous-symmetry covale A LIG C1 A LIG N1 1_555 2_555
loop_
_atom_site.group_PDB`
), 'mmcif');
assert.equal(ambiguousSymmetryStructConn.bonds.length, 0,
  'all candidate pairs from an ambiguous symmetry-qualified connection are denied to inference');
assert.equal(ambiguousSymmetryStructConn.topology.connectedComponents.length, 4);
const symmetryRows = Array.from({ length: 5001 }, (_, index) =>
  `symmetry-${index} covale A LIG C1 A LIG N1 1_555 2_555`).join('\n');
const repeatedAtom = alternateConformerCif.match(/^HETATM.*$/m)[0];
const connectionScaleFixture = alternateConformerCif
  .replace(/^HETATM.*(?:\nHETATM.*){3}/m, Array.from({ length: 5000 }, (_, index) =>
    repeatedAtom.replace(/^HETATM\s+\d+/, `HETATM ${index + 1}`)).join('\n'))
  .replace('loop_\n_atom_site.group_PDB', `loop_
_struct_conn.id
_struct_conn.conn_type_id
_struct_conn.ptnr1_label_asym_id
_struct_conn.ptnr1_label_comp_id
_struct_conn.ptnr1_label_atom_id
_struct_conn.ptnr2_label_asym_id
_struct_conn.ptnr2_label_comp_id
_struct_conn.ptnr2_label_atom_id
_struct_conn.ptnr1_symmetry
_struct_conn.ptnr2_symmetry
${symmetryRows}
loop_
_atom_site.group_PDB`);
assert.throws(() => Core.parseStructure(connectionScaleFixture, 'mmcif'), /connection limit/i,
  'struct_conn resolution work is bounded before scanning atom endpoints');
const secondRepeatedAtom = alternateConformerCif.match(/^HETATM.*$/gm)[1];
const deniedPairScaleFixture = alternateConformerCif
  .replace(/^HETATM.*(?:\nHETATM.*){3}/m, [
    ...Array.from({ length: 1001 }, (_, index) =>
      repeatedAtom.replace(/^HETATM\s+\d+/, `HETATM ${index + 1}`)),
    ...Array.from({ length: 1000 }, (_, index) =>
      secondRepeatedAtom.replace(/^HETATM\s+\d+/, `HETATM ${index + 1002}`))
  ].join('\n'))
  .replace('loop_\n_atom_site.group_PDB', `loop_
_struct_conn.id
_struct_conn.conn_type_id
_struct_conn.ptnr1_label_asym_id
_struct_conn.ptnr1_label_comp_id
_struct_conn.ptnr1_label_atom_id
_struct_conn.ptnr2_label_asym_id
_struct_conn.ptnr2_label_comp_id
_struct_conn.ptnr2_label_atom_id
_struct_conn.ptnr1_symmetry
_struct_conn.ptnr2_symmetry
broad-symmetry covale A LIG C1 A LIG N1 1_555 2_555
loop_
_atom_site.group_PDB`);
assert.throws(() => Core.parseStructure(deniedPairScaleFixture, 'mmcif'), /connection limit/i,
  'symmetry-denied pair materialization is capped before Cartesian expansion');
const modelScaleAtoms = Array.from({ length: 5001 }, (_, index) => repeatedAtom
  .replace(/^HETATM\s+\d+/, `HETATM ${index + 1}`)
  .replace(/\s1$/, ` ${index + 1}`)).join('\n');
const modelScaleFixture = alternateConformerCif
  .replace(/^HETATM.*(?:\nHETATM.*){3}/m, modelScaleAtoms)
  .replace('loop_\n_atom_site.group_PDB', `loop_
_struct_conn.id
_struct_conn.conn_type_id
_struct_conn.ptnr1_label_asym_id
_struct_conn.ptnr1_label_comp_id
_struct_conn.ptnr1_label_atom_id
_struct_conn.ptnr2_label_asym_id
_struct_conn.ptnr2_label_comp_id
_struct_conn.ptnr2_label_atom_id
one-connection covale A LIG C1 A LIG N1
loop_
_atom_site.group_PDB`);
assert.throws(() => Core.parseStructure(modelScaleFixture, 'mmcif'), /connection limit/i,
  'struct_conn resolution work is bounded across many coordinate models');
const crossConformerStructConn = Core.parseStructure(
  authorStructConnCif.replace('N1 A 1_555', 'N1 B 1_555'),
  'mmcif'
);
assert.ok(crossConformerStructConn.bonds.some(bond =>
  bond.provenance === 'mmcif-struct-conn' && bond.atomIndices[0] === 0 && bond.atomIndices[1] === 3),
'explicit mmCIF topology preserves a connection between named alternate conformers');

for (const [format, source] of [['pdb', alternateConformerPdb], ['mmcif', alternateConformerCif]]) {
  const alternateConformers = Core.parseStructure(source, format);
  assertNormalizedInvariants(alternateConformers);
  assert.deepEqual(JSON.parse(JSON.stringify(alternateConformers.bonds.map(bond => bond.atomIndices))), [[0, 1], [2, 3]],
    `${format} distance inference bonds within, but never across, alternate conformers`);
  assert.equal(alternateConformers.topology.connectedComponents.length, 2,
    `${format} alternate conformers remain separate connected components`);
}
const crossConformerConect = Core.parseStructure(
  alternateConformerPdb.replace('END', 'CONECT    1    4\nEND'), 'pdb'
);
assert.ok(crossConformerConect.bonds.some(bond =>
  bond.provenance === 'pdb-conect' && bond.atomIndices[0] === 0 && bond.atomIndices[1] === 3),
'explicit PDB CONECT topology preserves a connection between named alternate conformers');
assert.equal(crossConformerConect.bonds.filter(bond => bond.provenance === 'inferred-distance').length, 2,
  'alternate-location compatibility remains enforced for inferred bonds');

const modifiedResidue = Core.parseStructure(modifiedResiduePdb, 'pdb');
assertNormalizedInvariants(modifiedResidue);
const mseAtoms = modifiedResidue.atoms.filter(atom => atom.resn === 'MSE');
assert.ok(mseAtoms.length > 0);
assert.ok(mseAtoms.every(atom => atom.role === 'polymer' && atom.subtype === 'protein'));
assert.ok(mseAtoms.every(atom => atom.parentCompId === 'MET' && atom.classificationProvenance === 'pdb-modres'));
assert.ok(mseAtoms.every(atom => JSON.stringify(atom.parentCompIds) === '["MET"]'));
assert.equal(new Set(modifiedResidue.atoms.map(atom => atom.instanceIndex)).size, 1,
  'MODRES polymer residues remain in the surrounding polymer instance');
assert.equal(new Set(modifiedResidue.atoms.map(atom => atom.entityIndex)).size, 1,
  'MODRES polymer residues remain in the surrounding polymer entity');
assert.equal(Core.groupLigands(modifiedResidue.atoms, 'modified-residue').length, 0,
  'modified polymer residues are excluded from ligand analysis');
assert.equal(Core.matchSavedSelection({ kind: 'ligands', structureId: 'modified-residue' },
  modifiedResidue.atoms, 'modified-residue').valid, false, 'modified polymer residues do not match ligand selectors');
const fallbackModifiedResidue = Core.parseStructure(modifiedResiduePdb.replace(/^MODRES.*\n/m, ''), 'pdb');
assert.ok(fallbackModifiedResidue.atoms.filter(atom => atom.resn === 'MSE')
  .every(atom => atom.role === 'polymer' && atom.classificationProvenance === 'modified-residue-map'),
  'common modified residues retain a tested parent fallback when MODRES is absent');
const multiParentModified = Core.parseStructure(multiParentModifiedCif, 'mmcif');
assertNormalizedInvariants(multiParentModified);
const xaa = multiParentModified.atoms.find(atom => atom.resn === 'XAA');
const mixed = multiParentModified.atoms.find(atom => atom.resn === 'MIX');
assert.deepEqual(JSON.parse(JSON.stringify(xaa.parentCompIds)), ['UNK', 'MET']);
assert.equal(xaa.parentCompId, 'UNK', 'the first parent remains available through the compatibility field');
assert.equal(xaa.role, 'polymer');
assert.equal(xaa.subtype, 'protein', 'all declared parents are considered when recognizing a modified polymer');
assert.deepEqual(JSON.parse(JSON.stringify(mixed.parentCompIds)), ['MET', 'DA']);
assert.equal(mixed.role, 'unknown');
assert.equal(mixed.classificationProvenance, 'ambiguous-modified-residue-parent',
  'conflicting recognized parent families remain explicit instead of being guessed');
assert.deepEqual(JSON.parse(JSON.stringify(multiParentModified.topology.residues.map(residue => residue.parentCompIds))),
  [['UNK', 'MET'], ['MET', 'DA']], 'residue topology preserves every declared chemical-component parent');

const pdbAssembly = Core.parseStructure(pdbAssemblyText, 'pdb');
assertNormalizedInvariants(pdbAssembly);
assert.equal(pdbAssembly.assemblies.length, 1);
assert.equal(pdbAssembly.assemblies[0].oligomericCount, 2);
assert.equal(pdbAssembly.assemblies[0].instances.length, 2);
assert.deepEqual(JSON.parse(JSON.stringify(pdbAssembly.assemblies[0].generators[0].operatorSequences)), [['1'], ['2']]);
assert.deepEqual(JSON.parse(JSON.stringify(pdbAssembly.assemblyInstances[1].transform)).map(row => row[3]), [12, 0, 0, 1],
  'PDB BIOMT records produce the same base-instance/operator representation as mmCIF assemblies');
const softwareAssembly = Core.parseStructure(pdbAssemblyText.replace(
  'AUTHOR DETERMINED BIOLOGICAL UNIT: DIMERIC',
  'SOFTWARE DETERMINED QUATERNARY STRUCTURE: DODECAMERIC'
), 'pdb');
assert.equal(softwareAssembly.assemblies[0].oligomericCount, 12,
  'standard software-determined quaternary-structure remarks preserve larger named oligomers');
const numericAssembly = Core.parseStructure(pdbAssemblyText.replace(
  'AUTHOR DETERMINED BIOLOGICAL UNIT: DIMERIC',
  'SOFTWARE DETERMINED QUATERNARY STRUCTURE: 24-MERIC'
), 'pdb');
assert.equal(numericAssembly.assemblies[0].oligomericCount, 24,
  'numeric N-MERIC assembly descriptions preserve arbitrary positive oligomer counts');
const legacyNumericAssembly = Core.parseStructure(pdbAssemblyText.replace(
  'AUTHOR DETERMINED BIOLOGICAL UNIT: DIMERIC',
  'QUATERNARY STRUCTURE FOR THIS ENTRY: 21MERIC'
), 'pdb');
assert.equal(legacyNumericAssembly.assemblies[0].oligomericCount, 21,
  'the standard legacy quaternary-structure remark form is preserved');
const extendedNamedAssembly = Core.parseStructure(pdbAssemblyText.replace(
  'AUTHOR DETERMINED BIOLOGICAL UNIT: DIMERIC',
  'SOFTWARE DETERMINED QUATERNARY STRUCTURE: EICOSAMERIC'
), 'pdb');
assert.equal(extendedNamedAssembly.assemblies[0].oligomericCount, 20,
  'the full canonical monomer-through-eicosamer vocabulary is recognized');
const blankChainAssembly = Core.parseStructure(pdbAssemblyText
  .replace('APPLY THE FOLLOWING TO CHAINS: A', 'APPLY THE FOLLOWING TO CHAINS: NULL')
  .replaceAll('GLY A   1', 'GLY     1'), 'pdb');
assert.deepEqual(JSON.parse(JSON.stringify(blankChainAssembly.assemblies[0].generators[0].asymIds)), ['_'],
  'REMARK 350 NULL chain identifiers map to the normalized blank PDB chain');
assert.equal(blankChainAssembly.assemblyInstances.length, 2,
  'blank-chain biological assemblies retain every BIOMT instance');
const chainlessAssemblyText = pdbAssemblyText
  .replace('REMARK 350 APPLY THE FOLLOWING TO CHAINS: A\n', '')
  .replace('END', pdbAssemblyText.match(/^ATOM.*$/gm).map((line, index) =>
    line.replace(/^ATOM\s+\d+/, `ATOM      ${index + 3}`).replace('GLY A', 'GLY B')).join('\n') + '\nEND');
const chainlessAssembly = Core.parseStructure(chainlessAssemblyText, 'pdb');
assert.equal(chainlessAssembly.topology.instances.length, 2);
assert.deepEqual(JSON.parse(JSON.stringify(chainlessAssembly.assemblies[0].generators[0].asymIds)), []);
assert.equal(chainlessAssembly.assemblies[0].instances.length, 4,
  'REMARK 350 BIOMT generators without a repeated chain list apply to all deposited instances');

const conformance = Core.parseStructure(conformanceCif, 'mmcif');
assertNormalizedInvariants(conformance);
assert.equal(conformance.topology.entities.length, 6);
assert.equal(conformance.topology.instances.length, 7);
assert.equal(conformance.topology.instances.filter(instance => instance.entityIndex === 0).length, 2,
  'multiple polymer instances can reference one entity');
const protein = conformance.atoms.find(atom => atom.labelAsymId === 'A');
const dna = conformance.atoms.find(atom => atom.labelAsymId === 'C');
const rna = conformance.atoms.find(atom => atom.labelAsymId === 'D');
const sharedAuthorLigand = conformance.atoms.find(atom => atom.labelAsymId === 'E');
const water = conformance.atoms.find(atom => atom.labelAsymId === 'F');
const ion = conformance.atoms.find(atom => atom.labelAsymId === 'G');
assert.equal(protein.subtype, 'protein');
assert.equal(dna.subtype, 'dna');
assert.equal(rna.subtype, 'rna');
assert.equal(sharedAuthorLigand.authAsymId, rna.authAsymId, 'different instances may share an author chain');
assert.equal(water.authAsymId, null, 'missing author identity is preserved rather than invented');
assert.equal(water.role, 'solvent');
assert.equal(water.subtype, 'water');
assert.equal(ion.role, 'ion');
assert.ok(conformance.atoms.some(atom => atom.labelAltId === 'A'));
assert.ok(conformance.atoms.some(atom => atom.labelAltId === 'B'));
assert.equal(protein.icode, 'A', 'insertion codes survive normalization');
const ligandC = conformance.atoms.find(atom => atom.labelAsymId === 'E' && atom.labelAtomId === 'C1');
const ligandN = conformance.atoms.find(atom => atom.labelAsymId === 'E' && atom.labelAtomId === 'N1');
assert.ok(conformance.bonds.some(bond => new Set(bond.atomIndices).has(ligandC.index)
  && new Set(bond.atomIndices).has(ligandN.index)), 'explicit struct_conn bonds are retained');
assert.ok(conformance.bonds.some(bond => bond.atomIndices.includes(protein.index)),
  'covalent bonds absent from struct_conn are inferred');
assert.ok(conformance.bonds.some(bond => bond.provenance === 'inferred-distance' && bond.order === 1),
  'distance-inferred bonds retain explicit provenance and single order');
const productGenerator = conformance.assemblies[0].generators[0];
assert.deepEqual(JSON.parse(JSON.stringify(productGenerator.operatorSequences)), [['1', '3'], ['2', '3']]);
assert.equal(conformance.assemblies[0].instances.length, 9);
assert.equal(conformance.assemblyInstances.length, 9);
const translated = conformance.assemblyInstances.find(instance =>
  instance.baseInstanceId === 'A' && instance.operatorIds.join(',') === '2,3');
assert.deepEqual(JSON.parse(JSON.stringify(translated.transform)).map(row => row[3]), [0, 10, 0, 1],
  'operator products compose right-to-left into an explicit assembly-instance transform');
assert.throws(() => Core.parseStructure(conformanceCif.replace('(1-2)(3)', '(1-10001)(3)'), 'mmcif'),
  /assembly limit/i, 'assembly operator ranges have a materialization safety limit');
assert.throws(() => Core.parseStructure(conformanceCif.replace('(1-2)(3)', '(1-101)(1-101)'), 'mmcif'),
  /assembly limit/i, 'assembly operator Cartesian products have a safety limit');
assert.throws(() => Core.parseStructure(conformanceCif.replace('(1-2)(3)', '(1)'.repeat(101)), 'mmcif'),
  /assembly limit/i, 'assembly operator sequence length is bounded before repeated array copying');
assert.throws(() => Core.parseStructure(conformanceCif.replace(
  "1 '(1-2)(3)' A,B", "1 '(1-10000)' A\n1 '(1-10000)' B"
), 'mmcif'), /assembly limit/i, 'assembly transforms are capped across generator rows');
const repeatedAssemblyAsymIds = Core.parseStructure(conformanceCif.replace("'(1-2)(3)' A,B", "'(1-2)(3)' A,A,B,B"), 'mmcif');
assert.equal(repeatedAssemblyAsymIds.assemblyInstances.length, 9,
  'duplicate assembly asym IDs do not duplicate expanded instances');
const sharedAuthorPocket = Core.parseStructure(conformanceCif
  .replaceAll('10 GLY B ', '10 GLY A ')
  .replace('20.0  5.0 0.0', '2.0  2.5 0.0')
  .replace('21.3  5.0 0.0', '3.3  2.5 0.0'), 'mmcif');
const sharedAuthorLigandSelector = Core.groupLigands(sharedAuthorPocket, 'shared-author-pocket')[0].selector;
const sharedAuthorResidues = Core.analyzeLigandPocket(
  sharedAuthorPocket, sharedAuthorLigandSelector, 4, 'shared-author-pocket'
).residues.filter(residue => ['A', 'B'].includes(residue.selector.sourceIdentity?.labelAsymId));
assert.equal(sharedAuthorResidues.map(residue => residue.selector.sourceIdentity.labelAsymId).sort().join(','), 'A,B',
  'ligand pockets preserve distinct normalized residues that share an author residue tuple');

const equivalentPdb = Core.parseStructure(pdb, 'pdb');
const equivalentMmcif = Core.parseStructure(equivalentCif, 'mmcif');
assertNormalizedInvariants(equivalentPdb);
assertNormalizedInvariants(equivalentMmcif);
assert.equal(equivalentPdb.atoms.length, equivalentMmcif.atoms.length);
assert.deepEqual(JSON.parse(JSON.stringify(equivalentPdb.atoms.map(atom => [atom.element, atom.x, atom.y, atom.z]))),
  JSON.parse(JSON.stringify(equivalentMmcif.atoms.map(atom => [atom.element, atom.x, atom.y, atom.z]))),
  'paired PDB and mmCIF fixtures normalize equivalent coordinate facts identically');
assert.equal(equivalentPdb.topology.residues.length, equivalentMmcif.topology.residues.length);
assert.equal(equivalentPdb.topology.instances.length, equivalentMmcif.topology.instances.length);

const v1 = Core.normalizeDocument({
  format: 'molhtml/document', version: 1, documentId: 'v1', revision: 1,
  structure: { id: 'pdb', name: 'PDB', format: 'pdb', data: pdb, futureStructureField: 42 },
  scene: { colorMode: 'chain', futureSceneField: true },
  futureDocumentField: { preserved: true }
});
assert.equal(v1.version, 1, 'an untouched PDB v1 document remains v1');
assert.equal(v1.futureDocumentField.preserved, true);
assert.equal(v1.structure.futureStructureField, 42);
assert.equal(v1.scene.futureSceneField, true);
const extensionV1 = Core.normalizeDocument({
  ...v1, version: 1,
  scene: { ...v1.scene, extension: { accessibility: { role: 'presentation', entityId: 'visual-only' } } }
});
assert.equal(extensionV1.version, 1, 'unknown nested scene fields do not trigger identity-aware version gating');
const savedViewColorV1 = Core.normalizeDocument({
  ...v1, version: 1,
  scene: { ...v1.scene, savedViews: [{ title: 'Instances', snapshot: { colorMode: 'instance' } }] }
});
assert.equal(savedViewColorV1.version, 2, 'semantic color modes in saved views upgrade PDB documents to v2');
const semanticColorV1 = Core.normalizeDocument({
  ...v1, version: 1,
  scene: { ...v1.scene, colorMode: 'chain', customColors: [{
    scope: 'role', color: '#ffffff', selector: { structureId: 'pdb', role: 'ligand' }
  }] }
});
assert.equal(semanticColorV1.version, 2, 'semantic custom-color scopes upgrade PDB documents to v2');

const migratedV1Bindings = Core.normalizeDocument({
  format: 'molhtml/document', version: 1, documentId: 'legacy-bindings', revision: 1,
  structure: { id: 'legacy-structure', name: 'Legacy bindings', format: 'pdb', data: pdb },
  scene: {
    selection: { kind: 'atom', selector: { kind: 'atom', model: 1, chain: 'A', resi: 1, atom: 'N' } },
    customColors: [{ selector: { kind: 'chain', model: 1, chain: 'A' }, color: '#ffffff' }],
    measurements: [{ type: 'distance', atoms: [{ serial: 1 }, { serial: 2 }] }],
    savedSelections: [{ name: 'Legacy selection', selector: { kind: 'chain', model: 1, chain: 'A' } }],
    ligandAnalysis: { selectedLigand: { kind: 'instance', instanceId: 'legacy-instance' } },
    savedViews: [{ title: 'Legacy view', snapshot: {
      selection: { kind: 'atom', selector: { kind: 'atom', serial: 1 } },
      customColors: [{ selector: { kind: 'chain', chain: 'A' }, color: '#ffffff' }]
    } }]
  }
});
assert.equal(migratedV1Bindings.scene.selection.selector.structureId, 'legacy-structure');
assert.equal(migratedV1Bindings.scene.customColors[0].selector.structureId, 'legacy-structure');
assert.ok(migratedV1Bindings.scene.measurements[0].atoms.every(selector => selector.structureId === 'legacy-structure'));
assert.equal(migratedV1Bindings.scene.savedSelections[0].selector.structureId, 'legacy-structure');
assert.equal(migratedV1Bindings.scene.ligandAnalysis.selectedLigand.structureId, 'legacy-structure');
assert.equal(migratedV1Bindings.scene.savedViews[0].structureId, 'legacy-structure');
assert.equal(migratedV1Bindings.scene.savedViews[0].snapshot.selection.selector.structureId, 'legacy-structure');
assert.equal(migratedV1Bindings.scene.savedViews[0].snapshot.customColors[0].selector.structureId, 'legacy-structure');

const malformedV2Binding = Core.normalizeDocument({
  format: 'molhtml/document', version: 2, documentId: 'malformed-v2-binding', revision: 1,
  structure: { id: 'v2-structure', name: 'Malformed v2 binding', format: 'pdb', data: pdb },
  scene: { measurements: [{ type: 'distance', atoms: [{ serial: 1 }, { structureId: 'v2-structure', serial: 2 }] }] }
});
assert.equal(malformedV2Binding.scene.measurements[0].atoms[0].structureId, undefined,
  'v2 normalization does not silently repair malformed persisted selectors');
const malformedV2LigandBinding = Core.normalizeDocument({
  format: 'molhtml/document', version: 2, documentId: 'malformed-v2-ligand-binding', revision: 1,
  structure: { id: 'v2-structure', name: 'Malformed v2 ligand binding', format: 'pdb', data: pdb },
  scene: { ligandAnalysis: { selectedLigand: { model: 1, chain: 'A', resi: 1, resn: 'ALA' } } }
});
assert.equal(malformedV2LigandBinding.scene.ligandAnalysis.selectedLigand.structureId, undefined,
  'v2 ligand analysis preserves an unbound selector as invalid instead of silently repairing it');

Core.applyDocumentCommand(v1, { type: 'set-scene-field', field: 'colorMode', value: 'instance' });
assert.equal(v1.scene.colorMode, 'instance');
assert.equal(v1.version, 2, 'identity-aware commands upgrade the document version');
Core.applyDocumentCommand(v1, { type: 'set-selection', selection: { kind: 'atom', selector: { structureId: 'pdb' } } });
assert.equal(v1.scene.selection.kind, 'atom');
Core.applyDocumentCommand(v1, { type: 'set-measurements', measurements: [{ type: 'distance', atoms: [] }] });
assert.equal(v1.scene.measurements[0].type, 'distance');
assert.ok(v1.scene.measurements[0].id, 'measurement commands normalize records');
Core.applyDocumentCommand(v1, { type: 'set-saved-selections', savedSelections: [{ name: 'All ligands', selector: { kind: 'role', role: 'ligand', structureId: 'pdb' } }] });
assert.equal(v1.scene.savedSelections[0].selector.role, 'ligand');
Core.applyDocumentCommand(v1, { type: 'set-ligand-analysis', ligandAnalysis: { cutoff: 6 } });
assert.equal(v1.scene.ligandAnalysis.cutoff, 6);
Core.applyDocumentCommand(v1, { type: 'set-saved-views', savedViews: [{ title: 'Overview', structureId: 'pdb', snapshot: {} }] });
assert.equal(v1.scene.savedViews[0].title, 'Overview');
Core.applyDocumentCommand(v1, { type: 'set-camera', camera: { view: [0, 0, 0, 1, 0, 0, 0, 1] } });
assert.equal(v1.scene.camera.view.length, 8);
assert.throws(() => Core.applyDocumentCommand(v1, { type: 'set-scene-field', field: 'unknown', value: true }), /scene field/i);
assert.throws(() => Core.applyDocumentCommand(v1, { type: 'set-scene-field', field: 'colorMode', value: 'mystery' }), /color mode/i);

const v2 = Core.normalizeDocument({
  format: 'molhtml/document', version: 1, documentId: 'v2', revision: 1,
  structure: { id: structureId, name: '7RIL identity excerpt', format: 'cif', data: mmcif },
  scene: { colorMode: 'instance', savedSelections: [{ id: 'ligand', name: 'Ligand instance', selector: instanceSelector }] }
});
assert.equal(v2.version, 2, 'mmCIF and identity-aware features upgrade the logical document to v2');
assert.equal(v2.structure.format, 'mmcif');
assert.equal(v2.scene.savedSelections[0].selector.sourceIdentity.labelAsymId, 'C');
assert.equal('topology' in v2.structure, false, 'derived runtime topology is not serialized into the document');
assert.equal('coordinateSets' in v2.structure, false);
assert.equal('assemblies' in v2.structure, false);
assert.equal('indexes' in v2.structure, false);

assert.throws(() => Core.parseStructure(malformedCif, 'mmcif'), /atom_site|coordinates/i);
assert.throws(() => Core.parseStructure('data_empty\n_entry.id EMPTY\n', 'mmcif'), /atom_site|coordinates/i);
assert.throws(() => Core.normalizeDocument({ format: 'molhtml/document', version: 99, structure: { data: pdb } }), /version/i);

console.log('Format-neutral structure, mmCIF identity, topology, selector, and migration tests passed.');
