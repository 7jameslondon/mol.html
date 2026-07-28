import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const input = resolve('dist/MolView.molecule.html');
const output = resolve('output/roundtrip-agent-edit.molecule.html');
const html = await readFile(input, 'utf8');
const pattern = /(<script type="application\/molview\+json" id="molview-doc">\s*)([\s\S]*?)(\s*<\/script>)/i;
const match = html.match(pattern);
if (!match) throw new Error('Could not locate the molview document block.');

const doc = JSON.parse(match[2]);
doc.documentId = 'document-roundtrip-agent-test';
doc.revision += 1;
doc.modified = new Date().toISOString();
doc.modifiedBy = 'agent';
doc.scene.selection = {
  kind: 'atom',
  selector: { structureId: doc.structure.id, model: 1, chain: 'A', resi: 1, icode: '', atom: 'CA', altLoc: '', serial: 2 },
  identity: { kind: 'atom', structureId: doc.structure.id, model: 1, chain: 'A', residueName: 'ALA', residueNumber: 1, insertionCode: '', atomName: 'CA', alternateLocation: '', serial: 2, element: 'C' }
};
doc.scene.customColors.push({
  id: 'agent-color-test', scope: 'atom', color: '#ff0000',
  selector: { structureId: doc.structure.id, model: 1, chain: 'A', resi: 1, icode: '', atom: 'CA', altLoc: '', serial: 2 },
  label: 'ALA 1 · CA · chain A'
});

doc.scene.measurements.push({
  id: 'agent-measurement-test', type: 'distance',
  atoms: [
    { structureId: doc.structure.id, model: 1, chain: 'A', resi: 1, icode: '', atom: 'N', altLoc: '', serial: 1 },
    { structureId: doc.structure.id, model: 1, chain: 'A', resi: 1, icode: '', atom: 'CA', altLoc: '', serial: 2 }
  ],
  label: 'Backbone bond', note: 'Agent-authored annotation'
});

const json = JSON.stringify(doc, null, 2).replace(/</g, '\\u003c');
const edited = html.replace(pattern, `$1${json}$3`);
await mkdir(resolve('output'), { recursive: true });
await writeFile(output, edited, 'utf8');

const reread = await readFile(output, 'utf8');
const roundtrip = JSON.parse(reread.match(pattern)[2]);
if (roundtrip.modifiedBy !== 'agent' || roundtrip.scene.selection?.identity?.serial !== 2) throw new Error('Agent selection did not round-trip.');
if (roundtrip.scene.customColors.at(-1)?.color !== '#ff0000') throw new Error('Agent color did not round-trip.');
if (roundtrip.scene.measurements.at(-1)?.note !== 'Agent-authored annotation') throw new Error('Agent measurement did not round-trip.');
console.log(`Agent edit round-trip passed: ${output}`);
