import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/model.js', import.meta.url), 'utf8');
const fixture = await readFile(new URL('../fixtures/mini-peptide.pdb', import.meta.url), 'utf8');
const context = { window: {}, console, structuredClone };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'src/model.js' });
const Core = context.window.MolhtmlCore;

const extra = [
  'ATOM      6  P    DA B   1       4.000   0.000   0.000  1.00 20.00           P',
  "ATOM      7  C4'  DA B   1       5.500   0.000   0.000  1.00 20.00           C",
  'HETATM    8  H1  LIG C   9       8.000   0.000   0.000  1.00 20.00           H',
  'HETATM    9  C1  LIG C   9       9.000   0.000   0.000  1.00 20.00           C',
  'END'
].join('\n');
const parsed = Core.parsePDB(fixture.replace(/END\s*$/, '') + extra + '\n');
const hierarchy = Core.buildStructureHierarchy(parsed);

assert(hierarchy.length === 3, 'groups atoms into three ordered chains');
assert(hierarchy[0].chain === 'A' && hierarchy[0].residues.length === 1, 'preserves chain and residue order');
assert(hierarchy[0].residues[0].symbol === 'G' && hierarchy[0].residues[0].kind === 'protein', 'labels protein residues with one-letter codes');
assert(hierarchy[1].residues[0].symbol === 'A' && hierarchy[1].residues[0].kind === 'nucleic', 'labels nucleic-acid residues with base codes');
assert(hierarchy[2].residues[0].symbol === 'LIG' && hierarchy[2].residues[0].kind === 'other', 'uses a safe residue-name fallback');
assert(Core.representativeAtom(hierarchy[0].residues[0]).serial === 2, 'chooses CA for a protein residue');
assert(Core.representativeAtom(hierarchy[1].residues[0]).serial === 6, 'chooses phosphate for a nucleotide residue');
assert(Core.representativeAtom(hierarchy[2].residues[0]).serial === 9, 'prefers a non-hydrogen atom for an unknown residue');

const selector = Core.selectorForAtom(hierarchy[0].residues[0].atoms[1], 'atom', 'structure-test');
assert(selector.serial === 2 && selector.atom === 'CA' && selector.resi === 1, 'navigator atoms retain exact selection fields');

console.log('Navigator hierarchy and selection tests passed.');

function assert(condition, message) {
  if (!condition) throw new Error(`Navigator test failed: ${message}`);
}
