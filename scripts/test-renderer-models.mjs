import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

globalThis.window = {};
await import('../src/structure.js');
await import('../src/model.js');
const Core = window.MolhtmlCore;
const Structure = window.MolhtmlStructure;

const [rendererSource, multiModelCif, multiModelPdb, authorStructConnCif, ligandPocketPdb] = await Promise.all([
  readFile(new URL('../src/renderer.js', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/multi-model.cif', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/multi-model.pdb', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/author-struct-conn.cif', import.meta.url), 'utf8'),
  readFile(new URL('../fixtures/ligand-pocket.pdb', import.meta.url), 'utf8')
]);

const renderedModels = [];
const addedStyles = [];
const addedLabels = [];
const assignedStyles = [];
const addedLines = [];
let clickableCalls = 0;
let framebufferInitCalls = 0;
function nativeInitFrameBuffer() { framebufferInitCalls += 1; }
const mockGl = {
  ALIASED_LINE_WIDTH_RANGE: 'line-width-range',
  getParameter(key) { return key === this.ALIASED_LINE_WIDTH_RANGE ? [1, 2] : 8192; },
  isContextLost() { return false; }
};
const webglRenderer = {
  getContext: () => mockGl, devicePixelRatio: 1, initFrameBuffer: nativeInitFrameBuffer
};
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
  setViewChangeCallback() {}, setBackgroundColor() {},
  setStyle(selection, style) { assignedStyles.push({ selection, style }); },
  addStyle(selection, style) { addedStyles.push({ selection, style }); },
  addLabel(text, style) { addedLabels.push({ text, style }); },
  addLine(style) { addedLines.push(style); }, addSphere() {},
  setClickable() { clickableCalls += 1; }, zoomTo() {}, render() {}, setView() {},
  getRenderer() { return webglRenderer; },
  getView() { return [0, 0, 0, 1, 0, 0, 0, 1]; }
};
const context = {
  window: { MolhtmlCore: Core, MolhtmlStructure: Structure }, console, structuredClone, crypto: globalThis.crypto,
  requestAnimationFrame(callback) { callback(); },
  ResizeObserver: class { observe() {} },
  setTimeout, clearTimeout
};
context.globalThis = context;
context.window.$3Dmol = { createViewer: () => viewer, SurfaceType: { VDW: 1 } };
vm.runInNewContext(rendererSource, context, { filename: 'src/renderer.js' });

const doc = Core.normalizeDocument({
  format: 'molhtml/document', version: 2, documentId: 'renderer-models', revision: 1,
  structure: { id: 'multi-model', name: 'multi-model.cif', format: 'mmcif', data: multiModelCif },
  scene: {}
});
const renderer = new context.window.MoleculeRenderer({}, {});
assert.equal(webglRenderer.initFrameBuffer, nativeInitFrameBuffer,
  'the visible interactive renderer retains 3Dmol framebuffer initialization');
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

const exportStructure = Core.parseStructure(authorStructConnCif, 'mmcif');
const exportAtom = exportStructure.atoms[0];
const exportTarget = exportStructure.atoms[2];
const exportDocument = Core.normalizeDocument({
  ...authorDoc,
  documentId: 'renderer-export-contract',
  scene: {
    ...authorDoc.scene,
    representation: 'lines',
    camera: { view: [0, 0, 0, 1, 0, 0, 0, 1] },
    selection: { kind: 'atom', selector: Core.selectorForAtom(exportTarget, 'atom', authorDoc.structure.id) },
    savedSelections: [{
      id: 'saved-export-active', name: 'Export active',
      selector: { kind: 'atom', ...Core.selectorForAtom(exportAtom, 'atom', authorDoc.structure.id) }
    }],
    measurements: [{
      id: 'measurement-export-active', type: 'distance', label: 'Span',
      atoms: [
        Core.selectorForAtom(exportAtom, 'atom', authorDoc.structure.id),
        Core.selectorForAtom(exportTarget, 'atom', authorDoc.structure.id)
      ]
    }]
  }
});
const exportDocumentBefore = JSON.stringify(exportDocument);
const presentationState = {
  activeMeasurementId: 'measurement-export-active',
  activeSavedSelectionId: 'saved-export-active'
};

function renderExportScale(screenScale) {
  addedStyles.length = 0;
  addedLabels.length = 0;
  assignedStyles.length = 0;
  addedLines.length = 0;
  clickableCalls = 0;
  const exportRenderer = new context.window.MoleculeRenderer({}, {}, {
    backgroundAlpha: 0, interactive: false, screenScale, upscale: false
  });
  const generation = exportRenderer.setDocument(exportDocument, {
    cameraMode: 'snapshot', writeCamera: false, presentationState
  });
  return {
    renderer: exportRenderer,
    generation,
    labels: [...addedLabels],
    addedStyles: [...addedStyles],
    assignedStyles: [...assignedStyles],
    lines: [...addedLines],
    clickableCalls
  };
}

const currentExport = renderExportScale(1);
const highResolutionExport = renderExportScale(4);
assert.notEqual(webglRenderer.initFrameBuffer, nativeInitFrameBuffer,
  'the hidden non-interactive renderer stabilizes framebuffer reuse');
assert.equal(framebufferInitCalls, 0, 'the export-only framebuffer shim does not invoke the native resize allocator');
assert.equal(JSON.stringify(exportDocument), exportDocumentBefore,
  'snapshot export rendering never writes its camera or presentation state into the document clone');
assert.equal(currentExport.labels.length, 2, 'current-scale export includes only the persisted atom and measurement labels');
assert.equal(highResolutionExport.labels.length, 2, '4x export does not add a measurement-draft label');
assert.ok(!highResolutionExport.labels.some(label => label.text === '1'),
  'an unfinished measurement draft is absent from export rendering');
for (let index = 0; index < currentExport.labels.length; index += 1) {
  const current = currentExport.labels[index].style;
  const highResolution = highResolutionExport.labels[index].style;
  assert.equal(highResolution.fontSize / current.fontSize, 4, '4x label font size preserves normalized composition');
  assert.equal(highResolution.padding / current.padding, 4, '4x label padding preserves normalized composition');
  assert.equal(highResolution.borderThickness / current.borderThickness, 4,
    '4x label border preserves normalized composition');
}
assert.ok(highResolutionExport.addedStyles.some(entry => entry.style.stick?.color === '#30e3d2'),
  'the active persisted saved selection is emphasized in export rendering');
assert.ok(highResolutionExport.lines.some(line => line.color === '#ffcf5a'),
  'the active persisted measurement is emphasized in export rendering');
assert.ok(highResolutionExport.lines.every(line => line.linewidth >= 1 && line.linewidth <= 2),
  'measurement line widths are present and clamped to the reported WebGL range');
const currentLineStyle = currentExport.assignedStyles.find(entry => entry.style.line)?.style.line;
const highResolutionLineStyle = highResolutionExport.assignedStyles.find(entry => entry.style.line)?.style.line;
assert.equal(currentLineStyle.linewidth, 1.5, 'current-scale line representation retains its requested visible width');
assert.equal(highResolutionLineStyle.linewidth, 2, '4x line representation clamps to the hardware maximum');
assert.equal(currentExport.clickableCalls, 0, 'non-interactive export rendering installs no picking behavior');
assert.equal(highResolutionExport.clickableCalls, 0, 'repeated non-interactive export rendering installs no picking behavior');
await currentExport.renderer.whenSurfacesReady(currentExport.generation);
await highResolutionExport.renderer.whenSurfacesReady(highResolutionExport.generation);

console.log('Normalized PDB/mmCIF renderer bond, mapping, and strict selection tests passed.');
