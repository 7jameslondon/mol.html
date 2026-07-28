import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [structureSource, modelSource, rendererSource, multiModelCif] = await Promise.all([
  readFile(new URL('../src/structure.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/model.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer.js', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/multi-model.cif', import.meta.url), 'utf8')
]);

let Core;
const renderedModels = [];
const viewer = {
  addModel(data, format) {
    const parsed = Core.parseStructure(data, format === 'cif' ? 'mmcif' : format);
    const id = renderedModels.length;
    const atoms = parsed.atoms.map((atom, index) => ({
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
  },
  addModels() { throw new Error('Multi-model mmCIF must not use 3Dmol addModels().'); },
  removeAllModels() { renderedModels.length = 0; },
  removeAllSurfaces() {}, removeAllLabels() {}, removeAllShapes() {},
  setViewChangeCallback() {}, setBackgroundColor() {}, setStyle() {}, addStyle() {},
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
assert.equal(renderer.domainAtomForRenderer(renderedModels[0].atoms[0]).model, 1);
assert.equal(renderer.domainAtomForRenderer(renderedModels[1].atoms[0]).model, 2);

console.log('Multi-model mmCIF renderer separation and mapping tests passed.');
