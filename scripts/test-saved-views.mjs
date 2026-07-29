import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const structureSource = await readFile('src/structure.js', 'utf8');
const source = await readFile('src/model.js', 'utf8');
const context = vm.createContext({ window: {}, structuredClone, console });
vm.runInContext(structureSource, context, { filename: 'src/structure.js' });
vm.runInContext(source, context);
const Core = context.window.MolhtmlCore;

const cameraA = { view: [1, 2, 3, 25, 0, 0, 0, 1], futureCameraField: 'kept' };
const views = Core.normalizeSavedViews([
  {
    id: 'view-later', title: 'Later', order: 8, futureViewField: 42,
    snapshot: { camera: cameraA, representation: 'cartoon', futureSnapshotField: true, savedViews: [{ id: 'recursive' }] }
  },
  {
    id: 'view-first', title: '', note: 'Opening note', order: 1,
    snapshot: { camera: { view: null }, colorMode: 'chain' }
  }
]);
assert.deepEqual(views.map(view => view.id), ['view-first', 'view-later']);
assert.deepEqual(views.map(view => view.order), [0, 1]);
assert.equal(views[0].title, 'View 1');
assert.equal(views[0].narrative, 'Opening note');
assert.equal(views[1].futureViewField, 42);
assert.equal(views[1].snapshot.futureSnapshotField, true);
assert.equal(views[1].snapshot.savedViews, undefined);
assert.equal(views[1].snapshot.camera.futureCameraField, 'kept');

const normalizedDocument = Core.normalizeDocument({
  format: 'molhtml/document', version: 1,
  structure: { id: 'structure-test', name: 'Test', format: 'pdb', data: 'ATOM coordinates' },
  scene: { savedViews: views, futureSceneField: 'preserved', camera: cameraA }
});
assert.equal(normalizedDocument.scene.savedViews.length, 2);
assert.equal(normalizedDocument.scene.savedViews[1].futureViewField, 42);
assert.equal(normalizedDocument.scene.futureSceneField, 'preserved');
assert.equal(normalizedDocument.scene.camera.futureCameraField, 'kept');

const scene = {
  representation: 'sticks', colorMode: 'element', background: '#07111f',
  showHydrogens: false, showWater: true,
  selection: { kind: 'atom', selector: { structureId: 'structure-test', serial: 1 } },
  customColors: [{ id: 'color-test', color: '#ff0000' }],
  measurements: [{ id: 'measurement-kept' }],
  savedSelections: [{ id: 'selection-kept' }],
  ligandState: { selected: 'ATP' }, metadata: { method: 'X-RAY' },
  futureSceneField: { kept: true }, savedViews: views,
  camera: { view: [0, 0, 0, 20, 0, 0, 0, 1] }
};
const snapshot = Core.captureSavedViewSnapshot(scene, {
  camera: cameraA,
  activeAnalysis: { kind: 'measurement', id: 'measurement-kept' }
});
assert.equal(snapshot.measurements, undefined);
assert.equal(snapshot.savedViews, undefined);
assert.equal(snapshot.ligandState, undefined);
assert.equal(snapshot.camera.view[3], 25);
assert.equal(snapshot.activeAnalysis.id, 'measurement-kept');

const applied = Core.applySavedViewSnapshot(scene, {
  ...snapshot, representation: 'surface', background: '#102030'
});
assert.equal(applied.representation, 'surface');
assert.equal(applied.background, '#102030');
assert.equal(JSON.stringify(applied.measurements), JSON.stringify(scene.measurements));
assert.equal(JSON.stringify(applied.savedSelections), JSON.stringify(scene.savedSelections));
assert.equal(JSON.stringify(applied.ligandState), JSON.stringify(scene.ligandState));
assert.equal(JSON.stringify(applied.metadata), JSON.stringify(scene.metadata));
assert.equal(JSON.stringify(applied.futureSceneField), JSON.stringify(scene.futureSceneField));
assert.equal(JSON.stringify(applied.savedViews), JSON.stringify(scene.savedViews));
assert.notStrictEqual(applied.measurements, scene.measurements);

const moved = Core.reorderSavedViews(views, 'view-later', -1);
assert.deepEqual(moved.map(view => view.id), ['view-later', 'view-first']);
assert.deepEqual(moved.map(view => view.order), [0, 1]);
assert.deepEqual(Core.reorderSavedViews(moved, 'missing', 1).map(view => view.id), ['view-later', 'view-first']);

console.log('Saved-view normalization, snapshot application, and ordering tests passed.');
