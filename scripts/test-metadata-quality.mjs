import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/model.js', import.meta.url), 'utf8');
const fixture = await readFile(new URL('../fixtures/metadata-quality.pdb', import.meta.url), 'utf8');
const context = vm.createContext({ window: {}, structuredClone, console });
context.globalThis = context;
vm.runInContext(source, context, { filename: 'src/model.js' });
const Core = context.window.MolhtmlCore;

const metadata = Core.parsePDBMetadata(fixture);
assert.equal(metadata.classification, 'TEST OXIDOREDUCTASE QUALITY FIXTURE 1234');
assert.equal(metadata.depositionDate, '2024-01-01');
assert.equal(metadata.pdbId, '9XYZ');
assert.equal(metadata.title, 'EXAMPLE STRUCTURE FOR METADATA PARSING WITH A CONTINUED TITLE');
assert.equal(metadata.entityDescriptions[0], 'TEST ENZYME');
assert.equal(metadata.organisms[0], 'TESTUS ORGANISMUS');
assert.deepEqual([...metadata.experimentalMethods], ['X-RAY DIFFRACTION']);
assert.deepEqual([...metadata.authors], ['A.EXAMPLE', 'B.SCIENTIST']);
assert.deepEqual([...metadata.resolutionAngstroms], [1.75]);
assert.equal(metadata.primaryCitation.doi, '10.1234/EXAMPLE.2024.1');
assert.equal(metadata.primaryCitation.pubmedId, '12345678');
assert.equal(metadata.identifiers.databaseReferences[0].database, 'UNP');
assert.equal(metadata.flags.syntheticDemo, true);

const parsed = Core.parsePDB(fixture);
assert.equal(parsed.atoms.length, 6);
assert.equal(parsed.diagnostics.coordinateLines, 7);
assert.equal(parsed.diagnostics.skippedCoordinateLines, 1);
const quality = Core.deriveDataQuality(parsed, fixture);
assert.equal(quality.summary.atomCount, 6);
assert.equal(quality.summary.residueCount, 3);
assert.equal(quality.summary.chainCount, 1);
assert.equal(quality.summary.modelCount, 1);
assert.equal(quality.summary.alternateLocationAtoms, 1);
assert.equal(quality.summary.partialOccupancyAtoms, 1);
assert.equal(quality.summary.zeroOccupancyAtoms, 1);
assert.equal(quality.summary.nonWaterLigandCount, 1);
assert.equal(quality.summary.waterResidueCount, 1);
assert.equal(quality.summary.hydrogenAtomCount, 1);
assert.equal(quality.summary.malformedCoordinateLines, 1);
assert.deepEqual([...quality.diagnostics.malformedLineNumbers], [22]);
assert.equal(quality.summary.bFactor.min, 10);
assert.equal(quality.summary.bFactor.max, 50);
assert.ok(Math.abs(quality.summary.bFactor.mean - 29.1666666667) < 1e-8);
assert.ok(quality.warnings.some(item => item.code === 'synthetic-demo'));
assert.ok(quality.warnings.some(item => item.code === 'skipped-coordinate-lines'));

const normalized = Core.normalizeDocument({
  format: 'molhtml/document', version: 1,
  structure: {
    id: 'structure-metadata-test', name: 'Metadata fixture', format: 'pdb', data: fixture,
    metadata: {
      title: 'Authoritative title',
      provenance: { kind: 'test-source', futureProvenanceField: true },
      futureMetadataField: { preserved: true }
    }
  },
  scene: {}
});
assert.equal(normalized.structure.metadata.title, 'Authoritative title');
assert.equal(normalized.structure.metadata.classification, 'TEST OXIDOREDUCTASE QUALITY FIXTURE 1234');
assert.equal(normalized.structure.metadata.futureMetadataField.preserved, true);
assert.equal(normalized.structure.metadata.provenance.futureProvenanceField, true);

const rcsb = Core.metadataFromRCSBEntry({
  rcsb_id: '9XYZ',
  struct: { title: 'Authoritative RCSB title' },
  exptl: [{ method: 'X-RAY DIFFRACTION' }],
  rcsb_accession_info: { deposit_date: '2024-01-01T00:00:00Z', initial_release_date: '2024-02-01T00:00:00Z' },
  rcsb_entry_info: { resolution_combined: [1.75] },
  polymer_entities: [{
    rcsb_polymer_entity: { pdbx_description: 'Test enzyme' },
    rcsb_entity_source_organism: [{ ncbi_scientific_name: 'Testus organismus' }]
  }],
  audit_author: [{ name: 'Depositor A' }],
  rcsb_primary_citation: { id: 'primary', title: 'Primary paper', year: 2024, journal_abbrev: 'J Test', rcsb_authors: ['A. Example'], pdbx_database_id_DOI: '10.1234/test' }
}, { fetchedAt: '2026-07-27T00:00:00.000Z' });
assert.equal(rcsb.title, 'Authoritative RCSB title');
assert.equal(rcsb.releaseDate, '2024-02-01');
assert.equal(rcsb.primaryCitation.doi, '10.1234/test');
assert.deepEqual([...rcsb.authors], ['Depositor A']);
assert.equal(rcsb.provenance.kind, 'rcsb-data-api');

console.log('PDB metadata parsing, metadata normalization, and local quality derivation tests passed.');
