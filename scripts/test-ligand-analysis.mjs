import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixture = await readFile(new URL('../fixtures/ligand-pocket.pdb', import.meta.url), 'utf8');
globalThis.window = {};
await import('../src/structure.js');
await import('../src/model.js');
const Core = window.MolhtmlCore;
const parsed = Core.parsePDB(fixture);

const ligands = Core.groupLigands(parsed, 'structure-pocket-test');
assert.equal(ligands.length, 2, 'groups two non-water HETATM residue instances');
assert.equal(ligands[0].resn, 'LIG');
assert.equal(ligands[0].atomCount, 2);
assert.equal(ligands[0].heavyAtomCount, 2);
assert.match(ligands[0].label, /LIG 101.*chain B/);
assert.equal(ligands[1].resn, 'DRG');
assert(!ligands.some(ligand => ligand.resn === 'HOH'), 'excludes water from ligand instances');

const analysis = Core.analyzeLigandPocket(parsed, ligands[0].selector, 4, 'structure-pocket-test');
assert.equal(analysis.ligand.key, ligands[0].key);
assert.equal(analysis.residues.length, 2, 'finds protein and nucleic-acid residues in the pocket');
assert(analysis.contacts.some(contact => contact.classification === 'close' && !contact.polar), 'classifies a non-polar close contact');
assert(analysis.contacts.some(contact => contact.classification === 'polar' && contact.polar), 'classifies a plausible polar contact');
assert(analysis.contacts.every(contact => contact.distance <= 4), 'honors the requested cutoff');
assert.equal(Core.analyzeLigandPocket(parsed, ligands[0].selector, 2.5, 'structure-pocket-test').residues.length, 0, 'a tighter cutoff removes all fixture contacts');
assert.equal(Core.analyzeLigandPocket(parsed, ligands[1].selector, 4, 'structure-pocket-test').contacts.length, 0, 'handles an isolated ligand');

const manyAtoms = [...parsed.atoms];
for (let index = 0; index < 5000; index++) {
  manyAtoms.push({
    index: manyAtoms.length, serial: 1000 + index, name: 'CA', altLoc: '', resn: 'ALA',
    chain: 'Z', resi: index + 1, icode: '', x: 1000 + index * 5, y: 1000, z: 1000,
    occupancy: 1, bfactor: 20, element: 'C', het: false, model: 1
  });
}
const spatial = Core.analyzeLigandPocket(manyAtoms, ligands[0].selector, 4, 'structure-pocket-test');
assert(spatial.indexedAtomCount > 5000, 'indexes all eligible polymer atoms');
assert(spatial.candidatePairs < 50, 'queries local grid cells instead of comparing every atom pair');

const normalized = Core.normalizeDocument({
  format: 'molhtml/document', version: 1,
  structure: { id: 'structure-pocket-test', format: 'pdb', data: fixture },
  scene: {
    futureSceneField: true,
    ligandAnalysis: {
      selectedLigand: ligands[0].selector, cutoff: 99, showContacts: false,
      futureAnalysisField: 'preserved'
    }
  }
});
assert.equal(normalized.scene.ligandAnalysis.cutoff, 8, 'bounds oversized cutoffs');
assert.equal(normalized.scene.ligandAnalysis.showContacts, false);
assert.equal(normalized.scene.ligandAnalysis.showPocket, true, 'supplies additive defaults');
assert.equal(normalized.scene.ligandAnalysis.futureAnalysisField, 'preserved');
assert.equal(normalized.scene.futureSceneField, true);
const incompatible = Core.normalizeLigandAnalysis({ selectedLigand: ligands[0].selector }, 'different-structure');
assert.equal(incompatible.selectedLigand.structureId, 'structure-pocket-test',
  'normalization preserves a differently bound selector so it remains visibly invalid');
assert.equal(Core.findLigand(ligands, { ...ligands[0].selector, structureId: undefined }, 'structure-pocket-test'), null,
  'persisted ligand selectors without structureId cannot attach to the active structure');
const apiBound = Core.normalizeLigandAnalysis({
  selectedLigand: Object.fromEntries(Object.entries(ligands[0].selector).filter(([key]) => key !== 'structureId'))
}, 'structure-pocket-test', true);
assert.equal(apiBound.selectedLigand.structureId, 'structure-pocket-test',
  'the explicit API normalization path may bind an input selector to the active structure');

console.log('Ligand grouping, spatial cutoff search, classification, and normalization tests passed.');
