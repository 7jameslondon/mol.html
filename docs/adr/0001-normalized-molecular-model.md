# ADR 0001: Normalized molecular model and mmCIF parser boundary

- Status: Accepted
- Date: 2026-07-28
- Implementation branch: `feature/normalized-molecular-model`

## Context

The original application parsed only legacy PDB records and used author chain, residue number, atom name, and serial number as both display labels and molecular identity. That representation cannot reliably distinguish a molecular entity, its occurrence in the asymmetric unit, an author-assigned chain, a ligand, or a biological-assembly copy.

The 7RIL entry demonstrates the problem. Its template DNA is label asym ID `B`, entity `2`, and author chain `B`; the 5N0 ligand is label asym ID `C`, entity `3`, and also author chain `B`. Author-chain coloring should intentionally give them one color, while molecular-instance, entity, and role operations must distinguish them.

The project must also remain a deterministic, offline, self-contained HTML artifact with a strict size ceiling.

## Decision

Use a custom, format-neutral runtime model whose terminology and source identity follow PDBx/mmCIF:

- Preserve `_atom_site.id`, `label_*`, and `auth_*` fields independently.
- Preserve label and author alternate-location identifiers independently and use them when resolving atom identity.
- Represent atoms, residues, asymmetric-unit instances, entities, bonds, coordinate sets, connected components, and assembly operators explicitly.
- Represent each normalized bond as atom indexes plus bond order, connection type, and provenance so rendering and analysis consume the same topology.
- Use dense numeric indexes only at runtime.
- Preserve the original PDB or mmCIF text as the canonical embedded source.
- Serialize stable source identity and scene intent, not runtime topology or indexes.
- Keep 3Dmol behind a renderer adapter and verify a mapping from normalized atoms to renderer atom indexes.

PDB input is normalized into the same model. Missing entity and instance identities are generated deterministically and marked `pdb-inferred`. Classification carries provenance such as `mmcif-entity`, `pdb-record`, `name-fallback`, or `unknown`.

Modified polymer residues retain their source component name but derive polymer classification from explicit parent-component metadata (`MODRES` for PDB and Chemical Component data for mmCIF) when available. A small documented parent map is used only as a fallback. Distance-inferred bonds may connect a shared blank alternate location to a named conformer, but never two different named conformers.

`struct_conn` records that reference crystallographic symmetry mates are preserved in the canonical mmCIF source but excluded from base asymmetric-unit topology until the runtime model supports symmetry-qualified atom endpoints. The parser emits a diagnostic rather than installing a bond between incorrect base coordinates.

## Parser decision

Use a small first-party, category-preserving text mmCIF parser for the domain model.

The existing 3Dmol parser remains responsible for rendering, but it is not the domain parser. Its public result is a flattened display atom list and it does not provide the entity, assembly, and category-preserving interface required by mol.html. Depending on renderer-private parser state would also prevent an independent renderer boundary.

Selectively bundling Mol*'s CIF reader was rejected for this iteration because it would introduce a second large molecular-graphics dependency surface into an artifact with a 950,000-byte ceiling. The first-party parser supports the required text-CIF lexical forms, loop categories, atom sites, entity and struct-asym identity, explicit connections, metadata, and assembly operators.

BinaryCIF is deferred. It is an encoding optimization rather than the runtime model.

## Display and machine identity

- Author identifiers are the default familiar display labels.
- Label identifiers are the preferred machine identity.
- `_atom_site.id` plus model number is the highest-priority atom identity when present.
- Saved selectors fall back from atom-site identity to label identity, author identity, and finally legacy PDB serial identity.
- Atom selectors must resolve to exactly one atom, and residue selectors to exactly one residue. Missing or ambiguous resolution is explicit; it must not silently select a different atom or residue.

## Related viewer patterns

The decision follows useful boundaries from established viewers without copying any one
tool's internal representation:

- PyMOL treats evaluated selections as atom lists and allows reusable named selection
  expressions. mol.html similarly separates persisted selector intent from resolved runtime
  atom indexes.
- ChimeraX exposes an atomic-model/chain/residue/atom hierarchy and uses efficient molecular
  collections for computation. mol.html keeps the same kind of domain hierarchy behind
  interfaces that can later move from objects to compact storage.
- Mol* distinguishes element locations from compressed multi-element loci. mol.html likewise
  keeps canonical single-atom identity separate from compact resolved selection results.

These patterns support an application-owned model and selection engine; they do not imply
that a viewer session format is a suitable canonical molecular source format.

## Document versions

- An untouched PDB version 1 document remains version 1.
- Text mmCIF or identity-aware features require version 2.
- Unknown fields are preserved during normalization and save.
- Opening a document builds derived topology in memory; that topology is never added to `structure` in the document JSON.

## Consequences

Positive consequences:

- PDB and mmCIF use one application model and one selection engine.
- Author chain, molecular instance, entity, role, and connectivity have distinct semantics.
- Renderer replacement no longer requires redesigning the document or molecular features.
- The document remains inspectable, editable, and offline.

Costs and risks:

- The domain and renderer parse coordinates independently, so their atom mapping is checked and treated as a hard error if counts or identities cannot be reconciled.
- PDB entity inference is necessarily incomplete and must retain provenance.
- The parser increases first-party artifact size and must remain under the enforced budget.
- Full dictionary validation and BinaryCIF are not included in this decision.

## Deferred work

MolViewSpec interchange and BinaryCIF input are optional follow-up features. They are not part of the core pull request unless explicitly added to its agreed scope.

## Implementation measurements

The accepted implementation was measured on the feature branch after the deterministic
release build:

- Branch-start artifact: 862,392 bytes.
- Final artifact: 949,782 bytes.
- First-party increase: 87,390 bytes.
- Bundled 3Dmol payload: unchanged at 537,792 bytes.
- Remaining headroom under the 950,000-byte ceiling: 218 bytes.
- Model/schema and artifact verification: passed, including 67 artifact invariants.
- Browser regression suite: 29 tests passed in Chromium.
- Scheduled performance observation: the deterministic 5,000-atom case passed.

The measurements did not justify an inline worker or columnar storage in this iteration.
The model interfaces preserve those implementation options if larger real-world profiles do.

The scheduled 5,000-atom Chromium gate enforces these deliberately conservative ceilings:

- Parse through first render: 15 seconds.
- Navigator interaction: 5 seconds.
- Representation update: 8 seconds.
- Self-contained serialization: 5 seconds.
- JavaScript heap increase: 128 MiB; total measured heap: 256 MiB.
- Parsed atom safety limit: 2,000,000 atoms.

These are regression ceilings, not claims about typical performance. Tightening them should be
based on repeatable CI observations across supported environments.

## References

- [RCSB identifiers in PDB](https://www.rcsb.org/docs/general-help/identifiers-in-pdb)
- [RCSB entry 7RIL](https://www.rcsb.org/structure/7RIL)
- [PDBx/mmCIF dictionary resources](https://mmcif.wwpdb.org/)
- [wwPDB assembly operator-expression definition](https://mmcif.wwpdb.org/dictionaries/mmcif_pdbx_v50.dic/Items/_pdbx_struct_assembly_gen.oper_expression.html)
- [PyMOL atom selections](https://pymol.org/dokuwiki/doku.php?id=selection)
- [ChimeraX atomic structures](https://www.rbvi.ucsf.edu/chimerax/docs/devel/modules/atomic/atomic.html)
- [ChimeraX atom specifications](https://www.rbvi.ucsf.edu/chimerax/docs/user/commands/atomspec.html)
- [Mol* selections and loci](https://molstar.org/docs/plugin/selections/)
