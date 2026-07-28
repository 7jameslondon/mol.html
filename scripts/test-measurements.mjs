import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/model.js', import.meta.url), 'utf8');
const context = vm.createContext({ window: {}, structuredClone, console });
vm.runInContext(source, context, { filename: 'model.js' });
const Core = context.window.MolhtmlCore;

const point = (x, y, z) => ({ x, y, z });
assert.equal(Core.measurementValue('distance', [point(0, 0, 0), point(3, 4, 0)]), 5);
assert.ok(Math.abs(Core.measurementValue('angle', [point(1, 0, 0), point(0, 0, 0), point(0, 1, 0)]) - 90) < 1e-10);
assert.ok(Math.abs(Math.abs(Core.measurementValue('dihedral', [
  point(1, 0, 0), point(0, 0, 0), point(0, 1, 0), point(0, 1, 1)
])) - 90) < 1e-10);
assert.ok(Number.isNaN(Core.measurementValue('angle', [point(0, 0, 0), point(0, 0, 0), point(1, 0, 0)])));
assert.equal(Core.formatMeasurementValue('distance', 3.456), '3.46 Å');
assert.equal(Core.formatMeasurementValue('angle', 90.04), '90.0°');

const selectorA = { structureId: 'structure-test', model: 1, chain: 'A', resi: 1, icode: '', atom: 'CA', altLoc: '', serial: 1 };
const selectorB = { structureId: 'structure-test', model: 1, chain: 'A', resi: 2, icode: '', atom: 'N', altLoc: '', serial: 2 };
const normalized = Core.normalizeDocument({
  format: 'molhtml/document',
  version: 1,
  documentId: 'document-test',
  title: 'Geometry test',
  structure: { id: 'structure-test', name: 'Test', format: 'pdb', data: 'ATOM coordinates' },
  futureDocumentField: { preserved: true },
  scene: {
    futureSceneField: 'preserved',
    measurements: [{
      id: 'measurement-test', type: 'DISTANCE', atoms: [selectorA, selectorB],
      label: 'Span', note: 'Test note', futureMeasurementField: 42
    }]
  }
});

assert.equal(normalized.futureDocumentField.preserved, true);
assert.equal(normalized.scene.futureSceneField, 'preserved');
assert.equal(normalized.scene.measurements[0].type, 'distance');
assert.equal(normalized.scene.measurements[0].futureMeasurementField, 42);
assert.notStrictEqual(normalized.scene.measurements[0].atoms[0], selectorA);
assert.throws(
  () => Core.normalizeDocument({ ...normalized, format: ['mol', 'view/document'].join('') }),
  /not a molhtml\/document/
);

const atoms = [
  { ...point(0, 0, 0), model: 1, chain: 'A', resi: 1, icode: '', resn: 'ALA', name: 'CA', altLoc: '', serial: 1 },
  { ...point(1, 0, 0), model: 1, chain: 'A', resi: 2, icode: '', resn: 'GLY', name: 'N', altLoc: '', serial: 2 }
];
const resolved = Core.measurementAtoms(normalized.scene.measurements[0], atoms, 'structure-test');
assert.equal(resolved?.length, 2);
assert.equal(Core.measurementValue('distance', resolved), 1);
assert.equal(Core.measurementAtoms(normalized.scene.measurements[0], atoms, 'different-structure'), null);

console.log('Measurement geometry, normalization, and selector resolution tests passed.');
