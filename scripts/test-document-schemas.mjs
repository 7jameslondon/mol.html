import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [v1, v2] = await Promise.all([
  readFile(new URL('../schemas/molhtml-document-v1.schema.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../schemas/molhtml-document-v2.schema.json', import.meta.url), 'utf8').then(JSON.parse)
]);

function schemaErrors(root, schema, value, path = '$') {
  if (schema.$ref) {
    const target = schema.$ref.split('/').slice(1).reduce((current, segment) =>
      current?.[segment.replace(/~1/g, '/').replace(/~0/g, '~')], root);
    return target ? schemaErrors(root, target, value, path) : [`${path}: unresolved ${schema.$ref}`];
  }
  const errors = [];
  if (schema.allOf) {
    for (const branch of schema.allOf) errors.push(...schemaErrors(root, branch, value, path));
  }
  if (schema.oneOf) {
    const branchErrors = schema.oneOf.map(branch => schemaErrors(root, branch, value, path));
    const validBranchCount = branchErrors.filter(candidate => candidate.length === 0).length;
    if (validBranchCount !== 1) {
      errors.push(`${path}: expected exactly one schema alternative`);
      if (validBranchCount === 0) errors.push(...branchErrors.flat());
    }
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const matchesType = type => {
    if (type === 'null') return value === null;
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
    if (type === 'integer') return Number.isInteger(value);
    return typeof value === type;
  };
  if (types.length && !types.some(matchesType)) return [`${path}: expected ${types.join(' or ')}`];
  if ('const' in schema && value !== schema.const) errors.push(`${path}: expected constant ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: value is not in the enum`);
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path}: string is too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: string does not match ${schema.pattern}`);
  }
  if (typeof value === 'number' && schema.minimum != null && value < schema.minimum) errors.push(`${path}: number is below minimum`);
  if (Array.isArray(value) && schema.items) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: array has too few items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path}: array has too many items`);
    value.forEach((item, index) => errors.push(...schemaErrors(root, schema.items, item, `${path}[${index}]`)));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required || []) {
      if (!(required in value)) errors.push(`${path}.${required}: required property is missing`);
    }
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (key in value) errors.push(...schemaErrors(root, child, value[key], `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in (schema.properties || {}))) errors.push(`${path}.${key}: additional property is not allowed`);
      }
    }
  }
  return errors;
}

assert.equal(v1.properties.format.const, 'molhtml/document');
assert.equal(v1.properties.version.const, 1);
assert.equal(v1.properties.structure.properties.format.const, 'pdb');
assert.equal(v1.additionalProperties, true, 'v1 preserves unknown document fields');

assert.equal(v2.properties.format.const, 'molhtml/document');
assert.equal(v2.properties.version.const, 2);
assert.deepEqual(v2.properties.structure.properties.format.enum, ['pdb', 'mmcif']);
assert.equal(v2.additionalProperties, true, 'v2 preserves unknown document fields');
for (const field of ['atomSiteId', 'labelEntityId', 'labelAsymId', 'authAsymId', 'authSeqId', 'authAltId']) {
  assert.ok(v2.$defs.sourceIdentity.properties[field], `v2 source identity declares ${field}`);
}
for (const kind of ['atom', 'residue', 'chain', 'instance', 'entity', 'role', 'connected-component', 'within']) {
  assert.ok(v2.$defs.selectorReference.properties.kind.enum.includes(kind), `v2 selector declares ${kind}`);
}
for (const colorMode of ['chain', 'instance', 'entity', 'role']) {
  assert.ok(v2.$defs.scene.properties.colorMode.enum.includes(colorMode), `v2 scene declares ${colorMode} coloring`);
}

const validV1 = {
  format: 'molhtml/document', version: 1, documentId: 'legacy', revision: 1,
  structure: { id: 'structure-1', format: 'pdb', data: 'ATOM fixture', futureStructureField: true },
  scene: { representation: 'sticks', colorMode: 'chain', background: '#07111f', futureSceneField: true },
  futureDocumentField: { preserved: true }
};
const validV2 = {
  format: 'molhtml/document', version: 2, documentId: 'identity-aware', revision: 2,
  structure: { id: 'structure-2', format: 'mmcif', data: 'data_fixture', futureStructureField: true },
  scene: {
    representation: 'ball-and-stick', colorMode: 'instance', background: '#07111f',
    selection: {
      kind: 'atom',
      selector: {
        structureId: 'structure-2', model: 1,
        sourceIdentity: { modelNumber: 1, atomSiteId: '9', labelAsymId: 'C', labelAtomId: 'C1' }
      }
    },
    customColors: [{
      id: 'color-1', scope: 'atom', color: '#ff0000',
      selector: { structureId: 'structure-2', sourceIdentity: { modelNumber: 1, atomSiteId: '9' } }
    }],
    measurements: [{
      id: 'distance-1', type: 'distance', atoms: [
        { structureId: 'structure-2', sourceIdentity: { modelNumber: 1, atomSiteId: '9' } },
        { structureId: 'structure-2', sourceIdentity: { modelNumber: 1, atomSiteId: '10' } }
      ]
    }],
    savedSelections: [{
      id: 'ligand-instance', name: 'Ligand instance',
      selector: {
        kind: 'instance', structureId: 'structure-2', instanceId: 'C',
        sourceIdentity: { modelNumber: 1, labelEntityId: '3', labelAsymId: 'C', authAsymId: 'B' }
      }
    }],
    ligandAnalysis: {
      selectedLigand: { structureId: 'structure-2', model: 1, chain: 'B', resi: 201, resn: 'PIP' },
      cutoff: 4, showLigand: true, showPocket: true, showContacts: true, polarOnly: false
    },
    savedViews: [{
      id: 'view-1', title: 'Ligand', order: 0, structureId: 'structure-2',
      snapshot: {
        representation: 'sticks',
        selection: {
          kind: 'atom',
          selector: { structureId: 'structure-2', sourceIdentity: { modelNumber: 1, atomSiteId: '9' } }
        },
        customColors: [{
          color: '#ff0000',
          selector: { structureId: 'structure-2', sourceIdentity: { modelNumber: 1, atomSiteId: '9' } }
        }],
        camera: { view: null }
      }
    }],
    camera: { view: null },
    futureSceneField: true
  },
  futureDocumentField: { preserved: true }
};
assert.deepEqual(schemaErrors(v1, v1, validV1), [], 'a representative legacy document validates against v1');
assert.deepEqual(schemaErrors(v2, v2, validV2), [], 'a representative identity-aware document validates against v2');
assert.match(schemaErrors(v2, v2, { ...validV2, version: 1 }).join('\n'), /constant 2/);
assert.match(schemaErrors(v2, v2, { ...validV2, structure: { ...validV2.structure, format: 'bcif' } }).join('\n'), /enum/);
assert.match(schemaErrors(v2, v2, { ...validV2, scene: { ...validV2.scene, background: 'navy' } }).join('\n'), /does not match/);

const withoutCurrentStructure = structuredClone(validV2);
delete withoutCurrentStructure.scene.selection.selector.structureId;
assert.match(schemaErrors(v2, v2, withoutCurrentStructure).join('\n'), /structureId.*required/i,
  'current atom selections require structure binding');
const withoutMeasurementStructure = structuredClone(validV2);
delete withoutMeasurementStructure.scene.measurements[0].atoms[0].structureId;
assert.match(schemaErrors(v2, v2, withoutMeasurementStructure).join('\n'), /structureId.*required/i,
  'measurement atom references require structure binding');
const malformedMeasurement = structuredClone(validV2);
malformedMeasurement.scene.measurements[0].atoms = [];
assert.match(schemaErrors(v2, v2, malformedMeasurement).join('\n'), /too few items/i,
  'measurement atom arrays cannot be empty');
const withoutColorStructure = structuredClone(validV2);
delete withoutColorStructure.scene.customColors[0].selector.structureId;
assert.match(schemaErrors(v2, v2, withoutColorStructure).join('\n'), /structureId.*required/i,
  'custom-color selectors require structure binding');
const withoutSavedViewStructure = structuredClone(validV2);
delete withoutSavedViewStructure.scene.savedViews[0].snapshot.selection.selector.structureId;
assert.match(schemaErrors(v2, v2, withoutSavedViewStructure).join('\n'), /structureId.*required/i,
  'saved-view snapshot selections require structure binding');

console.log('Document v1/v2 schema contract tests passed.');
