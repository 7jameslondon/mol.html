import assert from 'node:assert/strict';

globalThis.window = {};
await import('../src/structure.js');
await import('../src/model.js');
const Core = window.MolhtmlCore;
const Structure = window.MolhtmlStructure;

assert.deepEqual(Core.normalizeInteractions(null), {
  enabled: false,
  types: { hydrogenBonds: true, saltBridges: true },
  includeWater: false
});
assert.deepEqual(Core.normalizeInteractions({
  enabled: 1,
  types: { hydrogenBonds: 0, futureType: 'kept' },
  includeWater: 'yes',
  futureInteractionField: 42
}), {
  enabled: true,
  types: { hydrogenBonds: false, saltBridges: true, futureType: 'kept' },
  includeWater: true,
  futureInteractionField: 42
});

const explicitCif = `data_interactions
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_alt_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_entity_id
_atom_site.label_seq_id
_atom_site.auth_atom_id
_atom_site.auth_comp_id
_atom_site.auth_asym_id
_atom_site.auth_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
_atom_site.pdbx_formal_charge
_atom_site.pdbx_PDB_model_num
ATOM 1 N ND2 . ASN A 1 1 ND2 ASN A 1 0.0 0.0 0.0 1.0 10.0 ? 1
ATOM 2 O OE1 . GLU B 2 2 OE1 GLU B 2 3.0 0.0 0.0 1.0 10.0 ? 1
ATOM 3 N NZ . LYS C 3 3 NZ LYS C 3 0.0 10.0 0.0 1.0 10.0 1 1
ATOM 4 O OD1 . ASP D 4 4 OD1 ASP D 4 3.8 10.0 0.0 1.0 10.0 -1 1
ATOM 5 N NE2 . GLN E 5 5 NE2 GLN E 5 0.0 20.0 0.0 1.0 10.0 ? 1
ATOM 6 O OD1 . ASN F 6 6 OD1 ASN F 6 3.1 20.0 0.0 1.0 10.0 ? 1
ATOM 7 N NH1 . ARG G 7 7 NH1 ARG G 7 0.0 30.0 0.0 1.0 10.0 ? 1
ATOM 8 O OE1 . GLU H 8 8 OE1 GLU H 8 3.9 30.0 0.0 1.0 10.0 ? 1
loop_
_struct_conn.id
_struct_conn.conn_type_id
_struct_conn.ptnr1_label_asym_id
_struct_conn.ptnr1_label_seq_id
_struct_conn.ptnr1_label_comp_id
_struct_conn.ptnr1_label_atom_id
_struct_conn.ptnr2_label_asym_id
_struct_conn.ptnr2_label_seq_id
_struct_conn.ptnr2_label_comp_id
_struct_conn.ptnr2_label_atom_id
_struct_conn.ptnr1_role
_struct_conn.ptnr2_role
_struct_conn.ptnr1_symmetry
_struct_conn.ptnr2_symmetry
_struct_conn.pdbx_dist_value
_struct_conn.details
H1 hydrog A 1 ASN ND2 B 2 GLU OE1 donor acceptor 1_555 1_555 3.00 'source hydrogen bond'
H1D hydrog B 2 GLU OE1 A 1 ASN ND2 acceptor donor 1_555 1_555 3.00 'duplicate reversed endpoints'
H2 hydbnd E 5 GLN NE2 F 6 ASN OD1 donor acceptor 1_555 1_555 3.10 'dictionary alias'
S1 saltbr C 3 LYS NZ D 4 ASP OD1 positive negative 1_555 1_555 3.80 'source salt bridge'
S2 sltbrg G 7 ARG NH1 H 8 GLU OE1 positive negative 1_555 1_555 ? 'dictionary alias without reported distance'
HBAD hydrog A 1 ASN ND2 B 2 GLU OE1 donor acceptor 2_555 1_555 3.00 'symmetry mate'
`;

const explicit = Core.parseStructure(explicitCif, 'mmcif');
assert.equal(explicit.interactions.length, 4, 'both supported spellings for each interaction type are preserved');
assert.equal(explicit.interactions.filter(record => record.type === 'hydrogen-bond').length, 2);
assert.equal(explicit.interactions.filter(record => record.type === 'salt-bridge').length, 2);
assert.equal(explicit.bonds.length, 0, 'interaction annotations are not topology bonds');
assert.equal(explicit.topology.connectedComponents.length, explicit.atoms.length,
  'interaction annotations do not merge connected components');
assert.ok(explicit.diagnostics.parserWarnings.some(warning => /symmetry mate/i.test(warning)));
const explicitHydrogen = explicit.interactions.find(record => record.sources[0].connectionId === 'H1');
assert.deepEqual(explicitHydrogen.participants.map(participant => participant.role), ['donor', 'acceptor']);
assert.equal(explicitHydrogen.direction, 'directed');
assert.equal(explicitHydrogen.reportedDistance, 3);
assert.equal(explicitHydrogen.sources[0].details, 'source hydrogen bond');
assert.equal(explicitHydrogen.sources.length, 2, 'duplicate explicit pairs merge provenance without replacing participant roles');
assert.deepEqual(explicitHydrogen.participants.map(participant => participant.role), ['donor', 'acceptor'],
  'canonical deduplication never reorders role-bearing participants');
assert.equal(explicitHydrogen.heuristicQuality, null);
assert.equal(explicit.atoms[2].formalCharge, 1);
assert.equal(explicit.atoms[3].formalCharge, -1);
const explicitAnalysis = Core.analyzeInteractions(explicit, 'structure-explicit');
assert.equal(explicitAnalysis.counts.total, 4, 'inferred duplicates do not supplement explicit atom pairs');
assert.equal(explicitAnalysis.counts.explicit, 4);
assert.equal(explicitAnalysis.counts.inferred, 0);
const explicitWithoutReportedDistance = explicitAnalysis.interactions.find(record =>
  record.sources.some(source => source.connectionId === 'S2')
);
assert.equal(explicitWithoutReportedDistance.reportedDistance, null,
  'a missing optional mmCIF distance remains null instead of becoming a fabricated zero');
assert.ok(Math.abs(explicitWithoutReportedDistance.distance - 3.9) < 1e-12,
  'geometric distance is retained when an explicit interaction omits its reported distance');

const scopedCif = `data_scoped_interactions
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_alt_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_entity_id
_atom_site.label_seq_id
_atom_site.auth_atom_id
_atom_site.auth_comp_id
_atom_site.auth_asym_id
_atom_site.auth_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
_atom_site.pdbx_PDB_model_num
ATOM 1 N ND2 A ASN A 1 1 ND2 ASN A 1 0.0 0.0 0.0 0.5 10.0 1
ATOM 2 N ND2 B ASN A 1 1 ND2 ASN A 1 0.0 0.0 0.0 0.5 10.0 1
ATOM 3 O OE1 . GLU B 2 2 OE1 GLU B 2 3.0 0.0 0.0 1.0 10.0 1
ATOM 4 N ND2 . ASN A 1 1 ND2 ASN A 1 0.0 0.0 0.0 1.0 10.0 2
ATOM 5 O OE1 . GLU B 2 2 OE1 GLU B 2 3.0 0.0 0.0 1.0 10.0 2
loop_
_struct_conn.id
_struct_conn.conn_type_id
_struct_conn.ptnr1_label_asym_id
_struct_conn.ptnr1_label_seq_id
_struct_conn.ptnr1_label_comp_id
_struct_conn.ptnr1_label_atom_id
_struct_conn.ptnr2_label_asym_id
_struct_conn.ptnr2_label_seq_id
_struct_conn.ptnr2_label_comp_id
_struct_conn.ptnr2_label_atom_id
_struct_conn.ptnr1_role
_struct_conn.ptnr2_role
_struct_conn.ptnr1_symmetry
_struct_conn.ptnr2_symmetry
_struct_conn.pdbx_dist_value
_struct_conn.pdbx_ptnr1_PDB_model_num
_struct_conn.pdbx_ptnr2_PDB_model_num
_struct_conn.details
VALID hydrog A 1 ASN ND2 B 2 GLU OE1 donor acceptor 1_555 1_555 3.0 2 2 'model-scoped record'
CROSS hydrog A 1 ASN ND2 B 2 GLU OE1 donor acceptor 1_555 1_555 3.0 1 2 'cross-model record'
AMBIG hydrog A 1 ASN ND2 B 2 GLU OE1 donor acceptor 1_555 1_555 3.0 1 1 'ambiguous endpoint'
UNRES hydrog Z 9 ASN ND2 B 2 GLU OE1 donor acceptor 1_555 1_555 3.0 1 1 'unresolved endpoint'
SYM hydrog A 1 ASN ND2 B 2 GLU OE1 donor acceptor 2_555 1_555 3.0 2 2 'symmetry mate'
`;
const scoped = Core.parseStructure(scopedCif, 'mmcif');
assert.equal(scoped.interactions.length, 1, 'only an unambiguous same-model base-coordinate record is retained');
assert.equal(scoped.interactions[0].model, 2);
assert.equal(scoped.interactions[0].sources[0].connectionId, 'VALID');
for (const warning of [/different coordinate models/i, /AMBIG.*ambiguous or unresolved/i,
  /UNRES.*ambiguous or unresolved/i, /SYM.*symmetry mate/i]) {
  assert.ok(scoped.diagnostics.parserWarnings.some(message => warning.test(message)),
    `parser reports rejected struct_conn case ${warning}`);
}

function atom(index, name, resn, residueIndex, x, y, element, formalCharge = null, altLoc = '') {
  return {
    index, serial: index + 1, name, resn, residueIndex, x, y, z: 0, element,
    formalCharge, altLoc, model: 1, chain: String.fromCharCode(65 + residueIndex),
    resi: residueIndex + 1, icode: '', sourceFormat: 'pdb', authAsymId: String.fromCharCode(65 + residueIndex),
    authSeqId: residueIndex + 1, authCompId: resn, authAtomId: name,
    labelAsymId: String.fromCharCode(65 + residueIndex), labelSeqId: String(residueIndex + 1),
    labelCompId: resn, labelAtomId: name, labelAltId: altLoc, authAltId: altLoc,
    atomSiteId: String(index + 1), instanceId: String.fromCharCode(65 + residueIndex), entityId: String(residueIndex + 1)
  };
}

function elementForAtomName(name) {
  return String(name).trim().replace(/^\d+/, '')[0].toUpperCase();
}

function analyzedPair(left, right, distance = 3, bonds = []) {
  const atoms = [
    atom(0, left.name, left.resn, 0, 0, 0, left.element || elementForAtomName(left.name), left.formalCharge ?? null),
    atom(1, right.name, right.resn, 1, distance, 0, right.element || elementForAtomName(right.name), right.formalCharge ?? null)
  ];
  return Core.analyzeInteractions({ atoms, bonds, interactions: [] }, `pair-${left.resn}-${left.name}-${right.resn}-${right.name}`);
}

const explicitSaltSiteAtoms = [
  atom(0, 'NH1', 'ARG', 0, 0, 0, 'N'),
  atom(1, 'NH2', 'ARG', 0, 0, 1, 'N'),
  atom(2, 'OD1', 'ASP', 1, 3, 0, 'O'),
  atom(3, 'OD2', 'ASP', 1, 3.8, 1, 'O')
];
const explicitSaltSiteAnalysis = Core.analyzeInteractions({
  atoms: explicitSaltSiteAtoms,
  bonds: [],
  interactions: [{
    type: 'salt-bridge',
    participants: [{ atomIndex: 1, role: 'positive' }, { atomIndex: 3, role: 'negative' }],
    distance: 3.8,
    sources: [{ kind: 'test-explicit', connectionId: 'SITE-PAIR' }]
  }]
}, 'explicit-salt-site-dedup');
const explicitSaltSiteRecords = explicitSaltSiteAnalysis.interactions
  .filter(record => record.type === 'salt-bridge');
assert.equal(explicitSaltSiteRecords.length, 1,
  'an explicit salt bridge suppresses inferred duplicates for the same charged-site pair');
assert.equal(explicitSaltSiteRecords[0].heuristicQuality, null, 'the explicit site-level record is retained');
assert.deepEqual(explicitSaltSiteRecords[0].participants.map(participant => participant.atomIndex), [1, 3]);
assert.equal(explicitSaltSiteRecords[0].sources[0].connectionId, 'SITE-PAIR',
  'explicit salt-bridge provenance survives site-level deduplication');

const standardAminoAcids = [
  'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
  'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL'
];
for (const residue of standardAminoAcids.filter(name => name !== 'PRO')) {
  assert.equal(analyzedPair({ resn: residue, name: 'N' }, { resn: 'GLU', name: 'OE1' }).counts.hydrogenBonds, 1,
    `${residue} backbone N is an MVP donor`);
}
const aminoDonors = {
  ARG: ['NE', 'NH1', 'NH2'], ASN: ['ND2'], GLN: ['NE2'], LYS: ['NZ'],
  SER: ['OG'], THR: ['OG1'], TRP: ['NE1'], TYR: ['OH']
};
for (const [resn, names] of Object.entries(aminoDonors)) for (const name of names) {
  assert.equal(analyzedPair({ resn, name }, { resn: 'GLU', name: 'OE1' }).counts.hydrogenBonds, 1,
    `${resn} ${name} is an MVP donor`);
}
const nucleotideDonors = {
  A: ['N6'], DA: ['N6'], ADE: ['N6'], C: ['N4'], DC: ['N4'], CYT: ['N4'],
  G: ['N1', 'N2'], DG: ['N1', 'N2'], GUA: ['N1', 'N2'],
  T: ['N3'], DT: ['N3'], THY: ['N3'], U: ['N3'], DU: ['N3'], URA: ['N3'],
  I: ['N1'], DI: ['N1']
};
for (const [resn, names] of Object.entries(nucleotideDonors)) for (const name of names) {
  assert.equal(analyzedPair({ resn, name }, { resn: 'GLU', name: 'OE1' }).counts.hydrogenBonds, 1,
    `${resn} ${name} is an MVP nucleotide donor`);
}
assert.equal(analyzedPair({ resn: 'HOH', name: 'O' }, { resn: 'GLU', name: 'OE1' }).counts.hydrogenBonds, 1,
  'water oxygen is a possible donor without explicit hydrogens');

for (const residue of standardAminoAcids) {
  for (const name of ['O', 'OXT']) {
    assert.equal(analyzedPair({ resn: 'ASN', name: 'ND2' }, { resn: residue, name }).counts.hydrogenBonds, 1,
      `${residue} ${name} is an MVP backbone acceptor`);
  }
}
const aminoAcceptors = {
  ASN: ['OD1'], ASP: ['OD1', 'OD2'], GLN: ['OE1'], GLU: ['OE1', 'OE2'],
  MET: ['SD'], SER: ['OG'], THR: ['OG1'], TYR: ['OH']
};
for (const [resn, names] of Object.entries(aminoAcceptors)) for (const name of names) {
  assert.equal(analyzedPair({ resn: 'ASN', name: 'ND2' }, { resn, name }).counts.hydrogenBonds, 1,
    `${resn} ${name} is an MVP side-chain acceptor`);
}
const nucleotideAcceptors = {
  A: ['N1', 'N3', 'N7'], DA: ['N1', 'N3', 'N7'], ADE: ['N1', 'N3', 'N7'],
  C: ['N3', 'O2'], DC: ['N3', 'O2'], CYT: ['N3', 'O2'],
  G: ['O6', 'N3', 'N7'], DG: ['O6', 'N3', 'N7'], GUA: ['O6', 'N3', 'N7'],
  T: ['O2', 'O4'], DT: ['O2', 'O4'], THY: ['O2', 'O4'],
  U: ['O2', 'O4'], DU: ['O2', 'O4'], URA: ['O2', 'O4'],
  I: ['O6', 'N3', 'N7'], DI: ['O6', 'N3', 'N7']
};
for (const [resn, names] of Object.entries(nucleotideAcceptors)) for (const name of names) {
  assert.equal(analyzedPair({ resn: 'ASN', name: 'ND2' }, { resn, name }).counts.hydrogenBonds, 1,
    `${resn} ${name} is an MVP nucleotide acceptor`);
}
for (const name of ['OP1', 'OP2', 'O1P', 'O2P', "O2'", "O3'", "O4'", "O5'", 'O2*']) {
  assert.equal(analyzedPair({ resn: 'ASN', name: 'ND2' }, { resn: 'A', name }).counts.hydrogenBonds, 1,
    `${name} is canonicalized and typed as a nucleotide acceptor`);
}
assert.equal(analyzedPair({ resn: 'ASN', name: 'ND2' }, { resn: 'HOH', name: 'O' }).counts.hydrogenBonds, 1,
  'water oxygen is an acceptor');
for (const rejected of [
  [{ resn: 'PRO', name: 'N' }, { resn: 'GLU', name: 'OE1' }],
  [{ resn: 'HIS', name: 'ND1' }, { resn: 'GLU', name: 'OE1' }],
  [{ resn: 'HIS', name: 'NE2' }, { resn: 'GLU', name: 'OE1' }],
  [{ resn: 'CYS', name: 'SG' }, { resn: 'GLU', name: 'OE1' }],
  [{ resn: 'GLU', name: 'OE1' }, { resn: 'ASP', name: 'OD1' }],
  [{ resn: 'LIG', name: 'N1' }, { resn: 'GLU', name: 'OE1' }],
  [{ resn: 'ASN', name: 'ND2' }, { resn: 'LIG', name: 'O1' }]
]) {
  assert.equal(analyzedPair(...rejected).counts.hydrogenBonds, 0,
    `${rejected[0].resn} ${rejected[0].name} / ${rejected[1].resn} ${rejected[1].name} is conservatively rejected`);
}
assert.equal(analyzedPair({ resn: 'ASN', name: 'ND2' }, { resn: 'HIS', name: 'ND1' }).counts.hydrogenBonds, 1,
  'an unprotonated neutral histidine ring nitrogen may accept');
assert.equal(analyzedPair({ resn: 'ASN', name: 'ND2' }, {
  resn: 'HIS', name: 'ND1', formalCharge: 1
}).counts.hydrogenBonds, 0, 'a positively charged histidine ring nitrogen does not accept');
const chargedHistidineResidue = [
  atom(0, 'ND2', 'ASN', 0, 0, 0, 'N'),
  atom(1, 'ND1', 'HIS', 1, 3, 0, 'N'),
  atom(2, 'NE2', 'HIS', 1, 100, 0, 'N', 1)
];
assert.equal(Core.analyzeInteractions({
  atoms: chargedHistidineResidue, bonds: [], interactions: []
}, 'charged-histidine-residue').counts.hydrogenBonds, 0,
'a neutral ring nitrogen does not accept when another atom marks its histidine residue as positive');

const histidineRichAtoms = [];
for (let pair = 0; pair < 256; pair += 1) {
  histidineRichAtoms.push(atom(pair * 2, 'ND2', 'ASN', pair * 2, 0, pair * 10, 'N'));
  histidineRichAtoms.push(atom(pair * 2 + 1, 'ND1', 'HIS', pair * 2 + 1, 3, pair * 10, 'N'));
}
let wholeStructureFilterCalls = 0;
Object.defineProperty(histidineRichAtoms, 'filter', {
  value(...args) {
    wholeStructureFilterCalls += 1;
    return Array.prototype.filter.apply(this, args);
  }
});
const histidineRichAnalysis = Core.analyzeInteractions({
  atoms: histidineRichAtoms, bonds: [], interactions: []
}, 'histidine-rich-scaling');
assert.equal(histidineRichAnalysis.counts.hydrogenBonds, 256);
assert.equal(wholeStructureFilterCalls, 0,
  'histidine classification uses a precomputed residue index instead of rescanning every atom per candidate');
assert.equal(analyzedPair({ resn: 'HIS', name: 'ND1' }, { resn: 'ASP', name: 'OD1' }).counts.saltBridges, 0,
  'histidine is not inferred as a positive salt site without formal-charge evidence');
assert.equal(analyzedPair({ resn: 'ASN', name: 'ND2' }, {
  resn: 'LIG', name: 'O1', formalCharge: -1
}).counts.hydrogenBonds, 1, 'an unfamiliar explicitly negative N/O/S atom may accept');
assert.equal(analyzedPair({ resn: 'LIG', name: 'N1', formalCharge: 1 }, {
  resn: 'GLU', name: 'OE1'
}).counts.hydrogenBonds, 0, 'formal charge alone does not make an unfamiliar atom a donor');

assert.equal(analyzedPair(
  { resn: 'ASN', name: 'ND2' }, { resn: 'GLU', name: 'OE1' }, 3,
  [{ atomIndices: [0, 1], order: 1 }]
).counts.hydrogenBonds, 0, 'direct covalent neighbors are excluded from inference');
const sameResidueAtoms = [
  atom(0, 'ND2', 'ASN', 0, 0, 0, 'N'),
  atom(1, 'OE1', 'GLU', 0, 3, 0, 'O')
];
assert.equal(Core.analyzeInteractions({ atoms: sameResidueAtoms, bonds: [], interactions: [] }, 'same-residue').counts.total, 0,
  'same-residue inferred interactions are excluded');
const crossModelAtoms = [
  atom(0, 'ND2', 'ASN', 0, 0, 0, 'N'),
  { ...atom(1, 'OE1', 'GLU', 1, 3, 0, 'O'), model: 2 }
];
assert.equal(Core.analyzeInteractions({ atoms: crossModelAtoms, bonds: [], interactions: [] }, 'cross-model').counts.total, 0,
  'nearby atoms from different coordinate models are never paired');
const explicitExcludedGeometry = Core.analyzeInteractions({
  atoms: sameResidueAtoms,
  bonds: [{ atomIndices: [0, 1], order: 1 }],
  interactions: [{
    type: 'hydrogen-bond', participants: [{ atomIndex: 0, role: 'donor' }, { atomIndex: 1, role: 'acceptor' }],
    direction: 'directed', distance: 3, sources: [{ kind: 'test-explicit' }]
  }]
}, 'explicit-bypasses-inference-exclusions');
assert.equal(explicitExcludedGeometry.counts.explicit, 1,
  'valid explicit source records bypass same-residue and covalent inference exclusions');

for (const [distance, expected] of [[2.499, 0], [2.5, 1], [3.5, 1], [3.501, 0]]) {
  assert.equal(analyzedPair({ resn: 'ASN', name: 'ND2' }, { resn: 'GLU', name: 'OE1' }, distance).counts.hydrogenBonds, expected,
    `hydrogen-bond heavy-atom cutoff ${distance} is handled inclusively`);
}
for (const [distance, expected] of [[3.999, 1], [4, 1], [4.001, 0]]) {
  assert.equal(analyzedPair({ resn: 'LYS', name: 'NZ' }, { resn: 'ASP', name: 'OD1' }, distance).counts.saltBridges, expected,
    `salt-bridge cutoff ${distance} is handled inclusively`);
}

function strictHydrogenGeometry(hydrogenAcceptorDistance, angleDegrees, donorSpec = { name: 'N1', resn: 'LIG' }) {
  const donor = atom(0, donorSpec.name, donorSpec.resn, 0, 0, 0, donorSpec.element || elementForAtomName(donorSpec.name));
  const hydrogen = atom(1, 'H1', 'LIG', 0, .5, 0, 'H');
  const radians = (180 - angleDegrees) * Math.PI / 180;
  const acceptor = atom(
    2, 'OE1', 'GLU', 1,
    hydrogen.x + hydrogenAcceptorDistance * Math.cos(radians),
    hydrogen.y + hydrogenAcceptorDistance * Math.sin(radians),
    'O'
  );
  return Core.analyzeInteractions({
    atoms: [donor, hydrogen, acceptor],
    bonds: [{ atomIndices: [0, 1], order: 1 }],
    interactions: []
  }, `strict-${hydrogenAcceptorDistance}-${angleDegrees}`);
}
assert.equal(strictHydrogenGeometry(2.6, 120).interactions[0]?.heuristicQuality, 'strict',
  'the exact H-acceptor and angle boundaries qualify');
assert.equal(strictHydrogenGeometry(2.601, 180).counts.hydrogenBonds, 0,
  'H-acceptor distances above 2.6 Å are rejected');
assert.equal(strictHydrogenGeometry(2.6, 119.9).counts.hydrogenBonds, 0,
  'donor-hydrogen-acceptor angles below 120 degrees are rejected');
assert.equal(strictHydrogenGeometry(2.6, 180, { name: 'ND1', resn: 'HIS' }).interactions[0]?.heuristicQuality, 'strict',
  'a histidine ring nitrogen with an explicitly bonded hydrogen may donate');
assert.equal(strictHydrogenGeometry(2.6, 180, { name: "O2'", resn: 'A' }).interactions[0]?.heuristicQuality, 'strict',
  'nucleotide sugar hydroxyl donation requires and honors an explicitly bonded hydrogen');

const atoms = [
  atom(0, 'ND2', 'ASN', 0, 0, 0, 'N'),
  atom(1, 'OE1', 'GLU', 1, 3, 0, 'O'),
  atom(2, 'O', 'HOH', 2, 0, 3, 'O'),
  atom(3, 'NZ', 'LYS', 3, 0, 10, 'N'),
  atom(4, 'OD1', 'ASP', 4, 4, 10, 'O'),
  atom(5, 'OD2', 'ASP', 4, -4, 10, 'O'),
  atom(6, 'OG', 'SER', 5, 0, 20, 'O'),
  atom(7, 'HG', 'SER', 5, 1, 20, 'H'),
  atom(8, 'OD1', 'ASP', 6, 2.6, 20, 'O'),
  atom(9, 'N1', 'LIG', 7, 0, 30, 'N', 1),
  atom(10, 'O1', 'LIG', 8, 4, 30, 'O', -1),
  atom(11, 'N1', 'LIG', 9, 0, 40, 'N'),
  atom(12, 'OE1', 'GLU', 10, 3, 40, 'O'),
  atom(13, 'ND2', 'ASN', 11, 0, 50, 'N', null, 'A'),
  atom(14, 'OE1', 'GLU', 12, 3, 50, 'O', null, 'B'),
  atom(15, 'N', 'ALA', 13, 0, 60, 'N'),
  atom(16, 'CA', 'ALA', 14, 1.5, 60, 'C'),
  atom(17, 'O', 'ALA', 15, 3, 60, 'O')
];
const inferredParsed = {
  atoms,
  bonds: [
    { atomIndices: [6, 7], order: 1 },
    { atomIndices: [15, 16], order: 1 },
    { atomIndices: [16, 17], order: 1 }
  ],
  interactions: []
};
const analysis = Core.analyzeInteractions(inferredParsed, 'structure-inference');
assert.equal(analysis.counts.hydrogenBonds, 3, 'typed, water-endpoint, and strict explicit-hydrogen cases qualify');
assert.equal(analysis.counts.saltBridges, 2, 'standard residue sites and unfamiliar formal-charge sites qualify');
assert.equal(analysis.partitionCounts.hydrogenBonds.withWater, 1);
assert.equal(analysis.search.truncated, false);
assert.ok(analysis.interactions.every(record => record.participants.every(participant => participant.selector.structureId === 'structure-inference')));
assert.ok(analysis.interactions.every(record => !record.participants.some(participant => 'x' in participant || 'element' in participant)));
const strict = analysis.interactions.find(record => record.participants.some(participant => participant.atomIndex === 6));
assert.equal(strict.heuristicQuality, 'strict');
assert.equal(strict.direction, 'directed');
const saltTie = analysis.interactions.find(record => record.type === 'salt-bridge'
  && record.participants.some(participant => participant.atomIndex === 3));
assert.ok(saltTie.participants.some(participant => participant.atomIndex === 4), 'equal salt-site distances break by canonical atom pair');
assert.ok(!analysis.interactions.some(record => record.participants.some(participant => participant.atomIndex === 11)),
  'unfamiliar neutral N/O/S atoms are not typed as hydrogen-bond participants');
assert.ok(!analysis.interactions.some(record => record.participants.some(participant => participant.atomIndex === 13)),
  'incompatible alternate conformers are excluded');
assert.ok(!analysis.interactions.some(record => record.participants.some(participant => participant.atomIndex === 15)),
  'atoms separated by two covalent edges are excluded');

const hidden = Core.selectInteractions(analysis, Core.normalizeInteractions(null));
assert.equal(hidden.total, 0);
assert.equal(hidden.interactions.length, 0);
const dry = Core.selectInteractions(analysis, { enabled: true, types: { hydrogenBonds: true, saltBridges: true }, includeWater: false });
assert.equal(dry.total, 4);
const withWater = Core.selectInteractions(analysis, { enabled: true, types: { hydrogenBonds: true, saltBridges: true }, includeWater: true });
assert.equal(withWater.total, 5);
assert.equal(Core.analyzeInteractions(inferredParsed, 'structure-inference').search.candidatePairs, analysis.search.candidatePairs,
  'cached analysis is stable for the same parsed structure object');

const waterPair = {
  atoms: [
    atom(0, 'O', 'HOH', 0, 0, 0, 'O'),
    atom(1, 'O', 'HOH', 1, 3, 0, 'O')
  ],
  bonds: [], interactions: []
};
const ambiguousWater = Core.analyzeInteractions(waterPair, 'water-pair').interactions[0];
assert.equal(ambiguousWater.direction, 'ambiguous');
assert.equal(ambiguousWater.heuristicQuality, 'possible');
assert.deepEqual(ambiguousWater.participants.map(participant => participant.role), ['donor-or-acceptor', 'donor-or-acceptor']);

const cappedAtoms = [];
for (let pair = 0; pair < 600; pair += 1) {
  const distance = 2.5 + pair / 1_000;
  cappedAtoms.push(atom(pair * 2, 'ND2', 'ASN', pair * 2, 0, pair * 10, 'N'));
  cappedAtoms.push(atom(pair * 2 + 1, 'OE1', 'GLU', pair * 2 + 1, distance, pair * 10, 'O'));
}
const cappedAnalysis = Core.analyzeInteractions({ atoms: cappedAtoms, bonds: [], interactions: [] }, 'capped');
assert.equal(cappedAnalysis.counts.hydrogenBonds, 600);
assert.equal(cappedAnalysis.interactions.length, 500, 'each interaction partition retains only its nearest 500 records');
const cappedDisplay = Core.selectInteractions(cappedAnalysis, {
  enabled: true, types: { hydrogenBonds: true, saltBridges: false }, includeWater: false
});
assert.equal(cappedDisplay.rendered, 500);
assert.equal(cappedDisplay.omitted, 100);
assert.equal(cappedDisplay.interactions[0].distance, 2.5);

const partitionedAtoms = [];
const partitionedInteractions = [];
const partitionDistances = [];
const partitionDefinitions = [
  ['hydrogen-bond', false], ['hydrogen-bond', true],
  ['salt-bridge', false], ['salt-bridge', true]
];
for (const [partitionIndex, [type, withWaterEndpoint]] of partitionDefinitions.entries()) {
  for (let item = 0; item < 501; item += 1) {
    const leftIndex = partitionedAtoms.length;
    const rightIndex = leftIndex + 1;
    const distance = ((item * partitionDefinitions.length) + partitionIndex + 1) / 1_000;
    const baseX = leftIndex * 10;
    partitionedAtoms.push(atom(leftIndex, 'C1', withWaterEndpoint ? 'HOH' : 'LIG', leftIndex, baseX, 0, 'C'));
    partitionedAtoms.push(atom(rightIndex, 'C2', 'LIG', rightIndex, baseX + 1, 0, 'C'));
    partitionedInteractions.push({
      type,
      participants: [
        { atomIndex: leftIndex, role: type === 'hydrogen-bond' ? 'donor' : 'positive' },
        { atomIndex: rightIndex, role: type === 'hydrogen-bond' ? 'acceptor' : 'negative' }
      ],
      direction: type === 'hydrogen-bond' ? 'directed' : null,
      distance,
      sources: [{ kind: 'test-explicit', partitionIndex, item }]
    });
    partitionDistances.push(distance);
  }
}
const partitionedAnalysis = Core.analyzeInteractions({
  atoms: partitionedAtoms, bonds: [], interactions: partitionedInteractions
}, 'four-partitions');
assert.deepEqual(partitionedAnalysis.partitionCounts, {
  hydrogenBonds: { withoutWater: 501, withWater: 501 },
  saltBridges: { withoutWater: 501, withWater: 501 }
});
assert.equal(partitionedAnalysis.interactions.length, 2_000,
  'each of the four partitions independently retains its nearest 500 records');
const mergedPartitionDisplay = Core.selectInteractions(partitionedAnalysis, {
  enabled: true, types: { hydrogenBonds: true, saltBridges: true }, includeWater: true
});
assert.equal(mergedPartitionDisplay.total, 2_004);
assert.equal(mergedPartitionDisplay.rendered, 500, 'the merged overlay has a separate global cap');
assert.equal(mergedPartitionDisplay.omitted, 1_504);
assert.deepEqual(
  mergedPartitionDisplay.interactions.map(record => record.distance),
  partitionDistances.sort((left, right) => left - right).slice(0, 500),
  'the merged cap selects the globally nearest records across all retained partitions'
);

const safety = Structure.forEachNearbyPair(
  [atom(0, 'C1', 'LIG', 0, 0, 0, 'C'), atom(1, 'C2', 'LIG', 1, 1, 0, 'C'), atom(2, 'C3', 'LIG', 2, 2, 0, 'C')],
  4,
  () => {},
  { maxCandidatePairs: 1 }
);
assert.equal(safety.truncated, true, 'nearby-pair work has an independent safety ceiling');
assert.equal(safety.candidatePairs, 1);

const truncationAtoms = Array.from({ length: 4_473 }, (_, index) =>
  atom(index, 'C', 'LIG', 0, 0, 0, 'C'));
const truncatedAnalysis = Core.analyzeInteractions({
  atoms: truncationAtoms, bonds: [], interactions: []
}, 'analysis-truncation');
assert.equal(truncatedAnalysis.search.candidatePairs, 10_000_000,
  'analysis stops exactly at its independent candidate-work ceiling');
assert.equal(truncatedAnalysis.search.truncated, true);
assert.equal(truncatedAnalysis.search.partial, true);
assert.equal(truncatedAnalysis.search.nearestComplete, false);
assert.equal(truncatedAnalysis.counts.total, 0,
  'partial counts remain well-formed when no visited candidate qualifies');

const denseChargedAtoms = [];
for (let index = 0; index < 101; index += 1) {
  denseChargedAtoms.push(atom(index, 'N1', 'LIG', index, 0, 0, 'N', 1));
}
for (let index = 0; index < 101; index += 1) {
  const atomIndex = denseChargedAtoms.length;
  denseChargedAtoms.push(atom(atomIndex, 'O1', 'LIG', atomIndex, 0, 0, 'O', -1));
}
const saltSiteLimitedAnalysis = Core.analyzeInteractions({
  atoms: denseChargedAtoms, bonds: [], interactions: []
}, 'salt-site-limit');
assert.equal(saltSiteLimitedAnalysis.search.saltSitePairLimit, 10_000);
assert.equal(saltSiteLimitedAnalysis.search.retainedSaltSitePairs, 10_000,
  'dense charged structures never materialize more than the salt-site safety bound');
assert.equal(saltSiteLimitedAnalysis.search.saltSitePairLimitReached, true);
assert.equal(saltSiteLimitedAnalysis.search.truncated, true);
assert.equal(saltSiteLimitedAnalysis.search.partial, true);
assert.equal(saltSiteLimitedAnalysis.search.nearestComplete, false);
assert.equal(saltSiteLimitedAnalysis.counts.saltBridges, 10_000,
  'visited salt-site counts remain explicit but partial at the safety abort');
assert.equal(saltSiteLimitedAnalysis.interactions.length, 500,
  'partition retention remains bounded when salt-site scanning aborts');

const normalizedDocument = Core.normalizeDocument({
  format: 'molhtml/document', version: 1,
  structure: { id: 'structure-test', name: 'Test', format: 'pdb', data: 'ATOM coordinates' },
  scene: { interactions: { enabled: true, types: { hydrogenBonds: false }, futureField: 'kept' } }
});
assert.equal(normalizedDocument.scene.interactions.enabled, true);
assert.equal(normalizedDocument.scene.interactions.types.saltBridges, true);
assert.equal(normalizedDocument.scene.interactions.futureField, 'kept');
Core.applyDocumentCommand(normalizedDocument, {
  type: 'set-interactions', interactions: { enabled: true, types: { saltBridges: false }, includeWater: true }
});
assert.equal(normalizedDocument.scene.interactions.types.hydrogenBonds, true);
Core.applyDocumentCommand(normalizedDocument, { type: 'reset-appearance' });
assert.deepEqual(normalizedDocument.scene.interactions, Core.normalizeInteractions(null));

const snapshot = Core.captureSavedViewSnapshot({
  interactions: { enabled: true, types: { hydrogenBonds: false, saltBridges: true }, includeWater: true },
  camera: { view: null }
});
assert.equal(snapshot.interactions.enabled, true);
assert.equal(Core.applySavedViewSnapshot({ interactions: Core.normalizeInteractions(null) }, snapshot).interactions.includeWater, true);

function pdbAtomLine({ serial, name, resn, chain, resi, x, y, z, element, charge }) {
  return `${'ATOM'.padEnd(6)}${String(serial).padStart(5)} ${String(name).padStart(4)} ${String(resn).padStart(3)} ${chain}${String(resi).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}${'1.00'.padStart(6)}${'10.00'.padStart(6)}${''.padStart(10)}${String(element).padStart(2)}${String(charge || '').padStart(2)}`;
}
const chargedPdb = [
  pdbAtomLine({ serial: 1, name: 'NZ', resn: 'LYS', chain: 'A', resi: 1, x: 0, y: 0, z: 0, element: 'N', charge: '1+' }),
  pdbAtomLine({ serial: 2, name: 'OD1', resn: 'ASP', chain: 'B', resi: 2, x: 4, y: 0, z: 0, element: 'O', charge: '1-' }),
  'END'
].join('\n');
const parsedChargedPdb = Structure.parseStructure(chargedPdb, 'pdb');
assert.equal(parsedChargedPdb.atoms[0].formalCharge, 1);
assert.equal(parsedChargedPdb.atoms[1].formalCharge, -1);

console.log('Interaction parsing, inference, filtering, persistence, and charge tests passed.');
