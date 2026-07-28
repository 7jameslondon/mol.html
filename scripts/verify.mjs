import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const file = resolve('dist/MolView.molecule.html');
const html = await readFile(file, 'utf8');
const checks = [];
const assert = (condition, message) => {
  checks.push({ condition, message });
  if (!condition) throw new Error(`Verification failed: ${message}`);
};

assert(html.startsWith('<!DOCTYPE html>'), 'artifact is a complete HTML document');
assert((html.match(/id="molview-doc"/g) || []).length === 1, 'artifact has exactly one document block');
assert(!/<script[^>]+src=/i.test(html), 'artifact has no external script dependencies');
assert(!/<link[^>]+href=/i.test(html), 'artifact has no external stylesheet dependencies');
assert(!/__[A-Z_]+__/.test(html), 'artifact has no unreplaced build markers');
assert(html.includes('3Dmol.js 2.5.5') && html.includes('["3Dmol"]'), '3Dmol.js 2.5.5 is bundled inline');
assert(html.includes('id="third-party-notices"') && html.includes('Redistribution and use in source and binary forms'), '3Dmol.js license notices are embedded');
assert(html.includes('window.molview'), 'artifact exposes the agent/browser API');
assert(html.includes('showSaveFilePicker'), 'artifact includes in-place self-save support');
assert(html.includes('https://files.rcsb.org/download/') && html.includes('async fetchPDB(id)'), 'artifact includes RCSB PDB fetching');
assert(html.includes('https://search.rcsb.org/rcsbsearch/v2/query') && html.includes('https://data.rcsb.org/graphql'), 'artifact includes RCSB full-text search and metadata lookup');
assert(html.includes('role="tab"') && html.includes('data-inspector-target="representation"'), 'artifact includes the ribbon and contextual inspector UI');
assert(html.includes('data-inspector-target="measurements"') && html.includes('beginMeasurement(type)'), 'artifact includes persistent measurement UI and API');
assert(html.includes('data-inspector-target="navigator"') && html.includes('id="navigator-tree"'), 'artifact includes the structure navigator command and tree');
assert(html.includes('id="navigator-sequences"') && html.includes('buildStructureHierarchy'), 'artifact includes locally derived sequence navigation');
assert(html.includes('data-inspector-target="saved-selections"') && html.includes('id="saved-selection-list"'), 'artifact includes named selection builder and list UI');
assert(html.includes('getSavedSelections()') && html.includes('highlightSavedSelection(id, focus = false)'), 'artifact exposes named selection browser APIs');
assert(html.includes('data-inspector-target="ligands"') && html.includes('analyzeLigandPocket'), 'artifact includes local ligand and pocket analysis');
assert(html.includes('listLigands()') && html.includes('setLigandAnalysis(changes)'), 'artifact exposes ligand analysis browser APIs');
assert(html.includes('data-inspector-target="metadata"') && html.includes('id="quality-stats"'), 'artifact includes the metadata and coordinate-quality inspector');
assert(html.includes('getMetadata()') && html.includes('getDataQuality()') && html.includes('deriveDataQuality'), 'artifact exposes metadata and locally derived quality APIs');
assert(html.includes('data-inspector-target="saved-views"') && html.includes('id="saved-view-list"'), 'artifact includes the saved-view ribbon command and inspector');
assert(html.includes('id="story-overlay"') && html.includes('startStory(id)'), 'artifact includes presentation story controls and API');

const match = html.match(/<script type="application\/molview\+json" id="molview-doc">\s*([\s\S]*?)\s*<\/script>/i);
assert(Boolean(match), 'document JSON can be extracted with a simple splice contract');
const doc = JSON.parse(match[1]);
assert(doc.format === 'molview/document' && doc.version === 1, 'document format is molview/document version 1');
assert(doc.structure?.format === 'pdb' && doc.structure.data.includes('\nATOM'), 'PDB coordinates are embedded in the file');
assert(doc.structure?.metadata?.provenance?.kind === 'generated-demo' && doc.structure.metadata.flags?.syntheticDemo, 'source metadata and the starter-data caveat are embedded');
assert(doc.scene?.camera && 'view' in doc.scene.camera && Array.isArray(doc.scene.customColors)
  && Array.isArray(doc.scene.measurements) && Array.isArray(doc.scene.savedSelections)
  && Array.isArray(doc.scene.savedViews) && doc.scene.ligandAnalysis?.cutoff === 4,
  'scene state is embedded and editable');

const info = await stat(file);
console.log(`Verified ${checks.length} invariants in ${file} (${(info.size / 1024).toFixed(1)} KB)`);
