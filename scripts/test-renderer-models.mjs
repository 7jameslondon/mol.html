import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [structureSource, modelSource, rendererSource, multiModelCif, multiModelPdb, authorStructConnCif, ligandPocketPdb] = await Promise.all([
  readFile(new URL('../src/structure.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/model.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer.js', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/multi-model.cif', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/multi-model.pdb', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/author-struct-conn.cif', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/ligand-pocket.pdb', import.meta.url), 'utf8')
]);

let Core;
const renderedModels = [];
const addedStyles = [];
const addedLabels = [];
function addRenderedModel(domainAtoms) {
  const id = renderedModels.length;
  const atoms = domainAtoms.map((atom, index) => ({
    index, model: id, serial: atom.serial, atom: atom.name, resn: atom.resn,
    chain: atom.chain === '_' ? '' : atom.chain, resi: atom.resi, elem: atom.element,
    hetflag: atom.het, x: atom.x, y: atom.y, z: atom.z, bonds: [], bondOrder: []
  }));
  const model = {
    id, atoms,
    selectedAtoms() { return atoms; },
    setColorByFunction() {}
  };
  renderedModels.push(model);
  return model;
}
const viewer = {
  addModel(data, format) {
    const parsed = Core.parseStructure(data, format === 'cif' ? 'mmcif' : format);
    return addRenderedModel(parsed.atoms);
  },
  addModels(data, format) {
    const parsed = Core.parseStructure(data, format);
    return parsed.coordinateSets.map(set => addRenderedModel(set.atomIndices.map(index => parsed.atoms[index])));
  },
  removeAllModels() { renderedModels.length = 0; },
  removeAllSurfaces() {}, removeAllLabels() {}, removeAllShapes() {},
  setViewChangeCallback() {}, setBackgroundColor() {}, setStyle() {},
  addStyle(selection, style) { addedStyles.push({ selection, style }); },
  addLabel(text, style) { addedLabels.push({ text, style }); },
  setClickable() {}, zoomTo() {}, render() {}, setView() {},
  getView() { return [0, 0, 0, 1, 0, 0, 0, 1]; }
};
const context = {
  window: {}, console, structuredClone, crypto: globalThis.crypto,
  requestAnimationFrame(callback) { callback(); },
  ResizeObserver: class { observe() {} },
  setTimeout, clearTimeout
};
context.globalThis = context;
vm.runInNewContext(structureSource, context, { filename: 'src/structure.js' });
vm.runInNewContext(modelSource, context, { filename: 'src/model.js' });
Core = context.window.MolhtmlCore;
context.window.$3Dmol = { createViewer: () => viewer, SurfaceType: { VDW: 1 } };
vm.runInNewContext(rendererSource, context, { filename: 'src/renderer.js' });

const doc = Core.normalizeDocument({
  format: 'molhtml/document', version: 2, documentId: 'renderer-models', revision: 1,
  structure: { id: 'multi-model', name: 'multi-model.cif', format: 'mmcif', data: multiModelCif },
  scene: {}
});
const renderer = new context.window.MoleculeRenderer({}, {});
renderer.setDocument(doc, { fit: true });

assert.equal(renderedModels.length, 2, 'each normalized mmCIF coordinate set becomes a separate renderer model');
assert.deepEqual(Array.from(renderedModels, model => model.atoms.length), [2, 2]);
assert.deepEqual(Array.from(renderedModels[0].atoms, atom => Array.from(atom.bonds)), [[1], [0]],
  'normalized explicit bonds are installed in the first renderer model');
assert.deepEqual(Array.from(renderedModels[1].atoms, atom => Array.from(atom.bonds)), [[1], [0]],
  'normalized explicit bonds are installed in the second renderer model');
assert.deepEqual(Array.from(renderedModels[0].atoms, atom => Array.from(atom.bondOrder)), [[2], [2]],
  'mmCIF double-bond order is installed in the first renderer model');
assert.deepEqual(Array.from(renderedModels[1].atoms, atom => Array.from(atom.bondOrder)), [[2], [2]],
  'mmCIF double-bond order is installed in the second renderer model');
assert.equal(renderer.domainAtomForRenderer(renderedModels[0].atoms[0]).model, 1);
assert.equal(renderer.domainAtomForRenderer(renderedModels[1].atoms[0]).model, 2);
assert.equal(renderer.to3DSelection({ model: 2, chain: 'A', resi: 1 }).model, 1,
  'fallback selections translate coordinate model numbers to exact renderer model indexes');

const pdbDoc = Core.normalizeDocument({
  format: 'molhtml/document', version: 1, documentId: 'renderer-pdb-models', revision: 1,
  structure: { id: 'multi-model-pdb', name: 'multi-model.pdb', format: 'pdb', data: multiModelPdb },
  scene: {}
});
const pdbRenderer = new context.window.MoleculeRenderer({}, {});
pdbRenderer.setDocument(pdbDoc, { fit: true });

assert.equal(renderedModels.length, 2, '3Dmol receives each PDB coordinate set as a separate renderer model');
assert.deepEqual(Array.from(renderedModels[0].atoms, atom => Array.from(atom.bonds)), [[1], [0]],
  'normalized trailing CONECT bonds are installed in the first PDB renderer model');
assert.deepEqual(Array.from(renderedModels[1].atoms, atom => Array.from(atom.bonds)), [[1], [0]],
  'normalized trailing CONECT bonds are installed in the second PDB renderer model');
assert.deepEqual(Array.from(renderedModels[0].atoms, atom => Array.from(atom.bondOrder)), [[1], [1]],
  'PDB bond order is installed in the first renderer model');
assert.deepEqual(Array.from(renderedModels[1].atoms, atom => Array.from(atom.bondOrder)), [[1], [1]],
  'PDB bond order is installed in the second renderer model');
assert.equal(pdbRenderer.domainAtomForRenderer(renderedModels[0].atoms[0]).model, 1);
assert.equal(pdbRenderer.domainAtomForRenderer(renderedModels[1].atoms[0]).model, 2);

const authorDoc = Core.normalizeDocument({
  format: 'molhtml/document', version: 2, documentId: 'renderer-author-bond', revision: 1,
  structure: { id: 'author-bond', name: 'author-struct-conn.cif', format: 'mmcif', data: authorStructConnCif },
  scene: {}
});
const authorRenderer = new context.window.MoleculeRenderer({}, {});
authorRenderer.setDocument(authorDoc, { fit: true });

assert.equal(renderedModels.length, 1);
assert.deepEqual(Array.from(renderedModels[0].atoms, atom => Array.from(atom.bonds)), [[2], [], [0], []],
  'single-model author-only struct_conn installs exactly the named renderer bond');
assert.deepEqual(Array.from(renderedModels[0].atoms, atom => Array.from(atom.bondOrder)), [[2], [], [2], []],
  'single-model explicit mmCIF bond order remains double in the renderer');
assert.equal(authorRenderer.domainAtomForRenderer(renderedModels[0].atoms[2]).serial, 3);

addedStyles.length = 0;
addedLabels.length = 0;
const ambiguousSelectionDoc = Core.normalizeDocument({
  ...authorDoc,
  documentId: 'renderer-ambiguous-selection',
  scene: {
    ...authorDoc.scene,
    selection: {
      kind: 'atom',
      selector: { structureId: 'author-bond', sourceIdentity: { modelNumber: 1, authAsymId: 'A' } }
    }
  }
});
const ambiguousSelectionRenderer = new context.window.MoleculeRenderer({}, {});
ambiguousSelectionRenderer.setDocument(ambiguousSelectionDoc, { fit: true });
assert.equal(addedStyles.length, 0, 'an ambiguous current atom selector creates no renderer highlight');
assert.equal(addedLabels.length, 0, 'an ambiguous current atom selector creates no renderer label');

addedStyles.length = 0;
addedLabels.length = 0;
const exactSelectionDoc = Core.normalizeDocument({
  ...authorDoc,
  documentId: 'renderer-exact-selection',
  scene: {
    ...authorDoc.scene,
    selection: {
      kind: 'atom',
      selector: {
        structureId: 'author-bond',
        sourceIdentity: {
          modelNumber: 1, authAsymId: 'A', authSeqId: '1', authCompId: 'LIG', authAtomId: 'C1', authAltId: 'A'
        }
      }
    }
  }
});
const exactSelectionRenderer = new context.window.MoleculeRenderer({}, {});
exactSelectionRenderer.setDocument(exactSelectionDoc, { fit: true });
assert.equal(addedStyles.length, 1, 'a uniquely resolved current atom creates one renderer highlight');
assert.deepEqual(JSON.parse(JSON.stringify(addedStyles[0].selection)), { model: 0, index: [0] },
  'current atom highlighting targets the exact normalized-to-renderer mapping');
assert.equal(addedLabels.length, 1, 'a uniquely resolved current atom creates one renderer label');

addedStyles.length = 0;
const pocketData = ligandPocketPdb.replace('END',
  'ATOM      9  CB  ALA A   1     -10.000   0.000   0.000  1.00 20.00           C\nATOM     10  H   ALA A   1      -1.500   0.000   0.000  1.00 20.00           H\nEND');
const pocketStructure = Core.parseStructure(pocketData, 'pdb');
const pocketDoc = Core.normalizeDocument({
  format: 'molhtml/document', version: 1, documentId: 'renderer-pocket', revision: 1,
  structure: { id: 'pocket', name: 'pocket.pdb', format: 'pdb', data: pocketData },
  scene: { showWater: true, ligandAnalysis: {
    selectedLigand: Core.groupLigands(pocketStructure, 'pocket')[0].selector,
    cutoff: 4, showLigand: false, showPocket: true, showContacts: false
  } }
});
const pocketRenderer = new context.window.MoleculeRenderer({}, {});
pocketRenderer.setDocument(pocketDoc, { fit: true });
const completeResidueStyle = addedStyles.find(entry => entry.selection.and?.[0]?.index?.includes(8));
assert.deepEqual(JSON.parse(JSON.stringify(completeResidueStyle.selection)), {
  and: [{ model: 0, index: [0, 1, 8, 9] }, { not: { elem: 'H' } }]
}, 'pocket styling includes complete normalized residues without overriding hydrogen visibility');

console.log('Normalized PDB/mmCIF renderer bond, mapping, and strict selection tests passed.');
