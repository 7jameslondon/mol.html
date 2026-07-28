import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLegalNotices, validateBuiltLicenseNotices } from './legal-notices.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFile(resolve(root, path), 'utf8');
const legal = await loadLegalNotices(root);

const [template, styles, model, renderer, persistence, app] = await Promise.all([
  read('src/index.html'), read('src/styles.css'),
  read('src/model.js'), read('src/renderer.js'), read('src/persistence.js'), read('src/app.js')
]);
const canonicalNoticesJson = JSON.stringify(legal.canonicalNotices).replace(/</g, '\\u003c');
const persistenceWithNotices = persistence
  .replace('__CANONICAL_LICENSE_NOTICES_JSON__', () => canonicalNoticesJson)
  .replace('__CANONICAL_LICENSE_NOTICES_SHA256__', legal.canonicalSha256);
if (persistenceWithNotices === persistence || /__CANONICAL_LICENSE_NOTICES_(?:JSON|SHA256)__/.test(persistenceWithNotices)) {
  throw new Error('Could not inject canonical license notices into persistence.js.');
}

for (const [name, source] of Object.entries({ threeDmol: legal.minifiedBundle, model, renderer, persistence: persistenceWithNotices, app })) {
  if (/<\/script/i.test(source)) throw new Error(`${name}.js contains a script-close sequence that would corrupt the single-file build.`);
}

const starterPdb = buildStarterStructure();
const document = {
  format: 'molhtml/document',
  version: 1,
  documentId: 'document-starter-molecular-scene',
  title: 'Protein and DNA starter scene',
  revision: 1,
  modified: new Date().toISOString(),
  modifiedBy: 'build',
  structure: {
    id: 'structure-starter-complex',
    name: 'Protein–DNA starter',
    format: 'pdb',
    data: starterPdb,
    metadata: {
      title: 'Synthetic coordinates for mol.html demonstration',
      classification: 'Illustrative protein-DNA starter',
      entityDescriptions: ['Illustrative protein and DNA starter scene'],
      provenance: { kind: 'generated-demo' },
      flags: {
        syntheticDemo: true,
        syntheticDemoRemark: 'This starter is for interface demonstration, not scientific analysis'
      }
    }
  },
  scene: {
    representation: 'ball-and-stick',
    colorMode: 'chain',
    background: '#07111f',
    showHydrogens: false,
    showWater: false,
    selection: null,
    customColors: [],
    measurements: [],
    savedSelections: [],
    ligandAnalysis: {
      selectedLigand: null,
      cutoff: 4,
      showLigand: true,
      showPocket: true,
      showContacts: true,
      polarOnly: false
    },
    savedViews: [],
    camera: { view: null }
  }
};

const replacements = {
  __STYLES__: styles,
  __DOCUMENT__: JSON.stringify(document, null, 2).replace(/</g, '\\u003c'),
  __LICENSE_NOTICES__: legal.canonicalNotices,
  __LICENSE_NOTICES_SHA256__: legal.canonicalSha256,
  __THREEDMOL_JS__: legal.minifiedBundle,
  __MODEL_JS__: model,
  __RENDERER_JS__: renderer,
  __PERSISTENCE_JS__: persistenceWithNotices,
  __APP_JS__: app
};

let html = template;
for (const [marker, content] of Object.entries(replacements)) {
  if (!html.includes(marker)) throw new Error(`Missing template marker ${marker}`);
  html = html.replace(marker, () => content);
}
if (/__[A-Z_]+__/.test(html)) throw new Error('An unreplaced build marker remains in the generated HTML.');
validateBuiltLicenseNotices(html, legal);
if (!html.includes(legal.minifiedBundle)) throw new Error('The audited 3Dmol.js bundle was altered during HTML assembly.');

const output = resolve(root, 'dist/example.mol.html');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, html, 'utf8');
console.log(`Built ${output} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB; license notices ${legal.canonicalSha256})`);

function buildStarterStructure() {
  const lines = [
    'HEADER    ILLUSTRATIVE PROTEIN-DNA STARTER',
    'TITLE     SYNTHETIC COORDINATES FOR MOL.HTML DEMONSTRATION',
    'REMARK    THIS STARTER IS FOR INTERFACE DEMONSTRATION, NOT SCIENTIFIC ANALYSIS'
  ];
  let serial = 1;
  const bonds = [];
  const residues = ['ALA', 'LEU', 'GLU', 'LYS', 'GLY', 'SER', 'VAL', 'ARG', 'ALA', 'GLN', 'LEU', 'GLY'];
  let previousProteinC = null;
  for (let i = 0; i < residues.length; i++) {
    const theta = i * 100 * Math.PI / 180;
    const z = (i - (residues.length - 1) / 2) * 1.52;
    const atoms = [
      ['N', 2.05, theta - .20, z - .47, 'N'],
      ['CA', 2.32, theta, z, 'C'],
      ['C', 2.08, theta + .20, z + .48, 'C'],
      ['O', 2.38, theta + .31, z + .77, 'O'],
      ['CB', 3.62, theta - .03, z + .08, 'C']
    ];
    const atomSerials = {};
    for (const [name, radius, angle, atomZ, element] of atoms) {
      const current = serial++;
      atomSerials[name] = current;
      lines.push(pdbAtom(current, name, residues[i], 'A', i + 1, radius * Math.cos(angle), radius * Math.sin(angle), atomZ, element));
    }
    bonds.push([atomSerials.N, atomSerials.CA], [atomSerials.CA, atomSerials.C], [atomSerials.C, atomSerials.O], [atomSerials.CA, atomSerials.CB]);
    if (previousProteinC) bonds.push([previousProteinC, atomSerials.N]);
    previousProteinC = atomSerials.C;
  }
  lines.push('TER');

  const bases = ['DA', 'DT', 'DG', 'DC', 'DA', 'DG', 'DT', 'DC'];
  const strands = [['B', 0], ['C', Math.PI]];
  for (const [chain, phase] of strands) {
    const order = phase ? [...bases].reverse().map(base => ({ DA: 'DT', DT: 'DA', DG: 'DC', DC: 'DG' })[base]) : bases;
    let previousO3 = null;
    for (let i = 0; i < order.length; i++) {
      const theta = phase + i * 36 * Math.PI / 180;
      const z = (i - (order.length - 1) / 2) * 3.35;
      const atoms = [
        ['P', 8.0, theta - .16, z - 1.15, 'P'],
        ["O5'", 7.45, theta - .08, z - .52, 'O'],
        ["C5'", 7.2, theta, z, 'C'],
        ["C4'", 6.72, theta + .08, z + .35, 'C'],
        ["C3'", 6.95, theta + .17, z + .92, 'C'],
        ["O3'", 7.48, theta + .21, z + 1.45, 'O'],
        ['N1', 3.65, theta + .03, z + .20, 'N']
      ];
      const atomSerials = {};
      for (const [name, radius, angle, atomZ, element] of atoms) {
        const current = serial++;
        atomSerials[name] = current;
        lines.push(pdbAtom(current, name, order[i], chain, i + 1, radius * Math.cos(angle), radius * Math.sin(angle), atomZ, element));
      }
      bonds.push([atomSerials.P, atomSerials["O5'"]], [atomSerials["O5'"], atomSerials["C5'"]], [atomSerials["C5'"], atomSerials["C4'"]], [atomSerials["C4'"], atomSerials["C3'"]], [atomSerials["C3'"], atomSerials["O3'"]], [atomSerials["C4'"], atomSerials.N1]);
      if (previousO3) bonds.push([previousO3, atomSerials.P]);
      previousO3 = atomSerials["O3'"];
    }
    lines.push('TER');
  }
  for (const [a, b] of bonds) lines.push(`CONECT${String(a).padStart(5)}${String(b).padStart(5)}`);
  lines.push('END');
  return lines.join('\n') + '\n';
}

function pdbAtom(serial, name, residue, chain, residueNumber, x, y, z, element) {
  const atomName = name.length < 4 ? ` ${name.padEnd(3)}` : name.slice(0, 4);
  return 'ATOM  ' + String(serial).padStart(5) + ' ' + atomName + ' ' + residue.padStart(3) + ' ' + chain + String(residueNumber).padStart(4) +
    '    ' + fixed(x, 8, 3) + fixed(y, 8, 3) + fixed(z, 8, 3) + fixed(1, 6, 2) + fixed(20, 6, 2) + '          ' + element.padStart(2);
}

function fixed(number, width, precision) {
  return Number(number).toFixed(precision).padStart(width);
}
