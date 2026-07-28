import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [structureSource, modelSource, mmcif, pdb, sharedChainPdb, multiModelPdb, conformanceCif, equivalentCif, malformedCif, pdbAssemblyText] = await Promise.all([
  readFile(new URL('../src/structure.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/model.js', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/7ril-identity.cif', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/mini-peptide.pdb', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/7ril-author-chain.pdb', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/multi-model.pdb', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/identity-conformance.cif', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/mini-peptide.cif', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/malformed.cif', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/pdb-assembly.pdb', import.meta.url), 'utf8')
]);
const context = { window: {}, console, structuredClone };
context.globalThis = context;
vm.runInNewContext(structureSource, context, { filename: 'src/structure.js' });
vm.runInNewContext(modelSource, context, { filename: 'src/model.js' });
const Core = context.window.MolhtmlCore;
const Structure = context.window.MolhtmlStructure;

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
  for (const [left, right] of bonds) {
    assert.ok(atoms[left]);
    assert.ok(atoms[right]);
    assert.notEqual(left, right);
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
const unresolved = Core.matchSavedSelection({
  ...atomSelector,
  sourceIdentity: {
    ...atomSelector.sourceIdentity,
    atomSiteId: 'missing-atom-site', labelAsymId: 'missing-instance', authAsymId: 'missing-chain'
  }
}, parsed.atoms, structureId);
assert.equal(unresolved.valid, false);
assert.match(unresolved.error, /did not resolve/i, 'missing source identity is reported explicitly');

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

const pdbAssembly = Core.parseStructure(pdbAssemblyText, 'pdb');
assertNormalizedInvariants(pdbAssembly);
assert.equal(pdbAssembly.assemblies.length, 1);
assert.equal(pdbAssembly.assemblies[0].oligomericCount, 2);
assert.equal(pdbAssembly.assemblies[0].instances.length, 2);
assert.deepEqual(JSON.parse(JSON.stringify(pdbAssembly.assemblies[0].generators[0].operatorSequences)), [['1'], ['2']]);
assert.deepEqual(JSON.parse(JSON.stringify(pdbAssembly.assemblyInstances[1].transform)).map(row => row[3]), [12, 0, 0, 1],
  'PDB BIOMT records produce the same base-instance/operator representation as mmCIF assemblies');

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
assert.ok(conformance.bonds.some(([left, right]) => new Set([left, right]).has(ligandC.index)
  && new Set([left, right]).has(ligandN.index)), 'explicit struct_conn bonds are retained');
assert.ok(conformance.bonds.some(([left, right]) => left === protein.index || right === protein.index),
  'covalent bonds absent from struct_conn are inferred');
const productGenerator = conformance.assemblies[0].generators[0];
assert.deepEqual(JSON.parse(JSON.stringify(productGenerator.operatorSequences)), [['1', '3'], ['2', '3']]);
assert.equal(conformance.assemblies[0].instances.length, 9);
assert.equal(conformance.assemblyInstances.length, 9);
const translated = conformance.assemblyInstances.find(instance =>
  instance.baseInstanceId === 'A' && instance.operatorIds.join(',') === '2,3');
assert.deepEqual(JSON.parse(JSON.stringify(translated.transform)).map(row => row[3]), [0, 10, 0, 1],
  'operator products compose right-to-left into an explicit assembly-instance transform');

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
Core.applyDocumentCommand(v1, { type: 'set-saved-views', savedViews: [{ title: 'Overview', snapshot: {} }] });
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
