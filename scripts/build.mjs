import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLegalNotices, validateBuiltLicenseNotices } from './legal-notices.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const normalizeLf = text => text.replace(/\r\n?/g, '\n');
const read = async path => normalizeLf(await readFile(resolve(root, path), 'utf8'));
const legal = await loadLegalNotices(root);

const [template, styles, structure, model, renderer, persistence, app, starterPdb] = await Promise.all([
  read('src/index.html'), read('src/styles.css'),
  read('src/structure.js'), read('src/model.js'), read('src/renderer.js'), read('src/persistence.js'), read('src/app.js'),
  read('src/starter-1bna.pdb')
]);
const canonicalNoticesJson = JSON.stringify(legal.canonicalNotices).replace(/</g, '\\u003c');
const persistenceWithNotices = persistence
  .replace('__CANONICAL_LICENSE_NOTICES_JSON__', () => canonicalNoticesJson)
  .replace('__CANONICAL_LICENSE_NOTICES_SHA256__', legal.canonicalSha256);
if (persistenceWithNotices === persistence || /__CANONICAL_LICENSE_NOTICES_(?:JSON|SHA256)__/.test(persistenceWithNotices)) {
  throw new Error('Could not inject canonical license notices into persistence.js.');
}

for (const [name, source] of Object.entries({ threeDmol: legal.minifiedBundle, structure, model, renderer, persistence: persistenceWithNotices, app })) {
  if (/<\/script/i.test(source)) throw new Error(`${name}.js contains a script-close sequence that would corrupt the single-file build.`);
}

const starterLines = starterPdb.trimEnd().split('\n');
const starterAtoms = starterLines.filter(line => line.startsWith('ATOM  '));
const starterAtomCount = starterAtoms.length;
const starterTerCount = starterLines.filter(line => line.startsWith('TER')).length;
const dnaResidueNames = new Set(['DA', 'DC', 'DG', 'DT']);
if (starterAtomCount !== 486 || starterTerCount !== 2
  || starterLines.at(-1) !== 'END'
  || starterLines.some(line => line.startsWith('HETATM'))
  || starterAtoms.some(line => !dnaResidueNames.has(line.slice(17, 20).trim()))
  || starterLines.some(line => !/^(?:ATOM  |TER|END)/.test(line))) {
  throw new Error('The 1BNA starter asset must contain exactly 486 DNA ATOM records, two TER records, and END.');
}
const document = {
  format: 'molhtml/document',
  version: 1,
  documentId: 'document-starter-molecular-scene',
  title: 'Dickerson–Drew dodecamer',
  revision: 1,
  // This describes the generated starter template, not a user's last edit.
  modified: '2026-07-28T00:00:00.000Z',
  modifiedBy: 'build',
  structure: {
    id: 'structure-1bna-dna',
    name: 'Dickerson–Drew dodecamer (1BNA)',
    format: 'pdb',
    data: starterPdb,
    source: {
      kind: 'rcsb-pdb',
      pdbId: '1BNA',
      url: 'https://files.rcsb.org/download/1BNA.pdb'
    },
    metadata: {
      title: 'STRUCTURE OF A B-DNA DODECAMER. CONFORMATION AND DYNAMICS',
      classification: 'DNA',
      pdbId: '1BNA',
      depositionDate: '1981-01-26',
      releaseDate: '1981-05-21',
      experimentalMethods: ['X-RAY DIFFRACTION'],
      resolutionAngstroms: [1.9],
      authors: ['Drew, H.R.', 'Wing, R.M.', 'Takano, T.', 'Broka, C.', 'Tanaka, S.', 'Itakura, K.', 'Dickerson, R.E.'],
      entityDescriptions: ["DNA (5'-D(*CP*GP*CP*GP*AP*AP*TP*TP*CP*GP*CP*G)-3')"],
      primaryCitation: {
        title: 'Structure of a B-DNA dodecamer: conformation and dynamics.',
        authors: ['Drew, H.R.', 'Wing, R.M.', 'Takano, T.', 'Broka, C.', 'Tanaka, S.', 'Itakura, K.', 'Dickerson, R.E.'],
        journal: 'PROC NATL ACAD SCI USA',
        year: 1981,
        doi: '10.1073/pnas.78.4.2179',
        pubmedId: '6941276'
      },
      identifiers: {
        pdbId: '1BNA',
        doi: '10.1073/pnas.78.4.2179',
        pubmedId: '6941276'
      },
      provenance: {
        kind: 'rcsb-data-api',
        url: 'https://data.rcsb.org/graphql',
        coordinateSource: 'rcsb-pdb',
        coordinateUrl: 'https://files.rcsb.org/download/1BNA.pdb'
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
  __STRUCTURE_JS__: structure,
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
