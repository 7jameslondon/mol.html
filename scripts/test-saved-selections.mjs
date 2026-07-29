import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const structureSource = await readFile(new URL('../src/structure.js', import.meta.url), 'utf8');
const source = await readFile(new URL('../src/model.js', import.meta.url), 'utf8');
const context = vm.createContext({ window: {}, structuredClone, console });
vm.runInContext(structureSource, context, { filename: 'structure.js' });
vm.runInContext(source, context, { filename: 'model.js' });
const Core = context.window.MolhtmlCore;

const atom = (serial, model, chain, resi, resn, name, x, y, z, options = {}) => ({
  index: serial - 1, serial, model, chain, resi, resn, name,
  icode: '', altLoc: '', element: options.element || 'C', het: Boolean(options.het),
  labelAsymId: chain, labelSeqId: String(resi), labelCompId: resn, labelAtomId: name, labelAltId: '',
  authAsymId: chain, authSeqId: String(resi), authCompId: resn, authAtomId: name,
  x, y, z
});
const atoms = [
  atom(1, 1, 'A', 1, 'ALA', 'N', 0, 0, 0, { element: 'N' }),
  atom(2, 1, 'A', 1, 'ALA', 'CA', 1, 0, 0),
  atom(3, 1, 'A', 2, 'GLY', 'CA', 3, 0, 0),
  atom(4, 1, 'A', 3, 'SER', 'CA', 6, 0, 0),
  atom(5, 1, 'B', 1, 'TYR', 'CA', 9, 0, 0),
  atom(6, 1, 'A', 101, 'LIG', 'C1', 12, 0, 0, { het: true }),
  atom(7, 1, 'A', 101, 'LIG', 'O1', 12.5, 0, 0, { het: true, element: 'O' }),
  atom(8, 1, 'A', 201, 'HOH', 'O', 20, 0, 0, { het: true, element: 'O' }),
  atom(9, 2, 'A', 1, 'ALA', 'N', 0, 0, 0, { element: 'N' })
];
const structureId = 'structure-test';

const selector = (kind, fields = {}) => ({ kind, structureId, ...fields });
const expectMatch = (query, atomCount, residueCount) => {
  const match = Core.matchSavedSelection(query, atoms, structureId);
  assert.equal(match.valid, true, match.error);
  assert.equal(match.atomCount, atomCount);
  assert.equal(match.residueCount, residueCount);
  return match;
};

expectMatch(selector('atom', { model: 1, chain: 'A', resi: 1, atom: 'CA', serial: 2 }), 1, 1);
expectMatch(selector('residue', { model: 1, chain: 'A', resi: 1, resn: 'ALA' }), 2, 1);
const ambiguousAtom = Core.matchSavedSelection(selector('atom', {
  sourceIdentity: { modelNumber: 1, labelAsymId: 'A' }
}), atoms, structureId);
assert.equal(ambiguousAtom.valid, false);
assert.match(ambiguousAtom.error, /ambiguous/i);
expectMatch(selector('atom', {
  sourceIdentity: {
    modelNumber: 1, labelAsymId: 'A', labelSeqId: '1', labelCompId: 'ALA', labelAtomId: 'CA'
  }
}), 1, 1);
const ambiguousResidue = Core.matchSavedSelection(selector('residue', {
  sourceIdentity: { modelNumber: 1, labelAsymId: 'A' }
}), atoms, structureId);
assert.equal(ambiguousResidue.valid, false);
assert.match(ambiguousResidue.error, /ambiguous/i);
expectMatch(selector('residue', {
  sourceIdentity: { modelNumber: 1, labelAsymId: 'A', labelSeqId: '1', labelCompId: 'ALA' }
}), 2, 1);
expectMatch(selector('chain', { model: 1, chain: 'A' }), 7, 5);
expectMatch(selector('residue-range', { model: 1, chain: 'A', start: { resi: 1 }, end: { resi: 2 } }), 3, 2);
const ligandMatch = expectMatch(selector('ligands'), 2, 1);
assert.deepEqual(ligandMatch.atoms.map(candidate => candidate.resn), ['LIG', 'LIG']);

const withinAtom = expectMatch(selector('within', {
  cutoff: 1.1,
  target: selector('atom', { model: 1, chain: 'A', resi: 1, atom: 'N', serial: 1 })
}), 2, 1);
assert.deepEqual(withinAtom.atoms.map(candidate => candidate.serial), [1, 2]);
assert.ok(!withinAtom.atoms.some(candidate => candidate.model === 2), 'proximity must not cross models');

expectMatch(selector('within', {
  cutoff: 0.75,
  target: selector('ligands')
}), 2, 1);

const empty = Core.matchSavedSelection(selector('ligands', { model: 2 }), atoms, structureId);
assert.equal(empty.valid, false);
assert.match(empty.error, /did not resolve/i);
assert.equal(empty.atomCount, 0);

assert.equal(Core.matchSavedSelection(selector('residue-range', {
  model: 1, chain: 'A', start: { resi: 3 }, end: { resi: 1 }
}), atoms, structureId).valid, false);
assert.match(Core.matchSavedSelection(selector('chain', { model: 1, chain: 'A' }), atoms, 'replacement').error, /different structure/i);
assert.match(Core.matchSavedSelection(selector('within', {
  cutoff: 4, target: selector('chain', { model: 1, chain: 'A' })
}), atoms, structureId).error, /target must be/i);

const normalized = Core.normalizeDocument({
  format: 'molhtml/document', version: 1, documentId: 'document-test', title: 'Selections',
  structure: { id: structureId, name: 'Test', format: 'pdb', data: 'ATOM coordinates' },
  futureDocumentField: { preserved: true },
  scene: {
    futureSceneField: 'preserved',
    savedSelections: [{
      id: 'selection-test', name: '  Nearby ligand  ', futureRecordField: 42,
      selector: {
        kind: 'WITHIN', structureId, cutoff: '4.5', futureSelectorField: 'preserved',
        target: { kind: 'LIGANDS', structureId, futureTargetField: true }
      }
    }]
  }
});

assert.equal(normalized.futureDocumentField.preserved, true);
assert.equal(normalized.scene.futureSceneField, 'preserved');
assert.equal(normalized.scene.savedSelections[0].name, 'Nearby ligand');
assert.equal(normalized.scene.savedSelections[0].futureRecordField, 42);
assert.equal(normalized.scene.savedSelections[0].selector.kind, 'within');
assert.equal(normalized.scene.savedSelections[0].selector.cutoff, 4.5);
assert.equal(normalized.scene.savedSelections[0].selector.futureSelectorField, 'preserved');
assert.equal(normalized.scene.savedSelections[0].selector.target.kind, 'ligands');
assert.equal(normalized.scene.savedSelections[0].selector.target.futureTargetField, true);
assert.equal(Core.normalizeDocument({
  format: 'molhtml/document', version: 1,
  structure: { id: structureId, name: 'Test', format: 'pdb', data: 'ATOM coordinates' },
  scene: {}
}).scene.savedSelections.length, 0);

console.log('Named selection normalization and compound selector matching tests passed.');
