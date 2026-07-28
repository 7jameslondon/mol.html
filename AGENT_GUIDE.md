# mol.html agent guide

The complete molecular document is stored in one plaintext block inside the
HTML file:

```html
<script type="application/molhtml+json" id="molhtml-doc">
{ "format": "molhtml/document", "version": 1, ... }
</script>
```

Edit only the JSON inside this block. Leave the application shell untouched.
Escape every `<` in JSON strings as `\u003c` so data can never terminate the
script block. Preserve fields you do not understand.

## Change protocol

For every edit:

1. Verify `format` is `molhtml/document` and `version` is `1`.
2. Read `scene.selection` when the user says “this atom”, “this residue”, or
   “this chain”.
3. Apply the smallest targeted state change.
4. Increment `revision` by one.
5. Set `modified` to an ISO-8601 timestamp and `modifiedBy` to `agent`.

The user can then refresh the browser. If the browser has an in-place file
handle, it also detects an external revision and asks for a reload.

For structures fetched from RCSB, `structure.source` records `kind`, `pdbId`,
the official download `url`, and `fetchedAt`. Preserve this provenance when
editing other scene fields.

## Structure metadata and coordinate quality

Source metadata is embedded in `structure.metadata` so it remains available
offline. Preserve unknown fields at every level. Common fields are:

```json
{
  "title": "Structure title",
  "classification": "TRANSFERASE",
  "pdbId": "1ABC",
  "depositionDate": "2024-01-15",
  "releaseDate": "2024-03-20",
  "organisms": ["Homo sapiens"],
  "experimentalMethods": ["X-RAY DIFFRACTION"],
  "resolutionAngstroms": [1.8],
  "authors": ["A.AUTHOR"],
  "entityDescriptions": ["Example protein"],
  "primaryCitation": {
    "title": "Primary citation title",
    "authors": ["A. Author"],
    "journal": "J MOL BIOL",
    "year": 2024,
    "doi": "10.0000/example",
    "pubmedId": "12345678"
  },
  "identifiers": { "pdbId": "1ABC", "doi": "10.0000/example" },
  "provenance": {
    "kind": "rcsb-data-api",
    "url": "https://data.rcsb.org/graphql",
    "fetchedAt": "2026-07-27T00:00:00.000Z"
  }
}
```

Locally imported PDB files use `provenance.kind` `embedded-pdb-header`; fetched
entries use `rcsb-data-api` when that lookup succeeds. `metadataWarnings` may
explain that only PDB-header fallback data was available. Do not remove those
warnings unless the metadata has actually been refreshed from its named source.

Coordinate counts, occupancy observations, B-factor statistics, ligand/water
counts, malformed-line detection, and synthetic/demo remarks are deliberately
derived at runtime rather than persisted. They are descriptive checks, not a
scientific quality score. In the open page, read them with
`window.molhtml.getDataQuality()`.

## Selection

An atom click writes both a machine selector and a readable identity:

```json
{
  "kind": "atom",
  "selector": {
    "structureId": "structure-id",
    "model": 1,
    "chain": "A",
    "resi": 42,
    "icode": "",
    "atom": "CA",
    "altLoc": "",
    "serial": 317
  },
  "identity": {
    "kind": "atom",
    "chain": "A",
    "residueName": "GLY",
    "residueNumber": 42,
    "atomName": "CA",
    "serial": 317,
    "element": "C"
  }
}
```

## Coloring selections

Append rules to `scene.customColors`; later rules win.

```json
{
  "id": "color-ca-317",
  "scope": "atom",
  "selector": {
    "structureId": "structure-id",
    "model": 1,
    "chain": "A",
    "resi": 42,
    "icode": "",
    "atom": "CA",
    "altLoc": "",
    "serial": 317
  },
  "color": "#ff0000",
  "label": "GLY 42 · CA · chain A"
}
```

For a residue rule, omit atom-specific fields and retain `chain`, `resi`,
`icode`, and optionally `resn`. For a chain rule, retain only `structureId`,
`model`, and `chain`.

## Named and compound selections

Reusable queries live in `scene.savedSelections`. Each record has a stable
`id`, a user-editable `name`, and one `selector`. Selector records use
molecular identity rather than array indices. Every selector, including a
nested proximity target, must use the current `structure.id` as its
`structureId`.

```json
{
  "id": "selection-active-site-neighborhood",
  "name": "Active-site neighborhood",
  "selector": {
    "kind": "within",
    "structureId": "structure-id",
    "cutoff": 4,
    "target": {
      "kind": "residue",
      "structureId": "structure-id",
      "model": 1,
      "chain": "A",
      "resi": 42,
      "icode": "",
      "resn": "GLY"
    }
  }
}
```

Supported selector shapes are:

- `atom`: `kind`, `structureId`, `model`, `chain`, `resi`, `icode`, `atom`,
  `altLoc`, and `serial`, with optional `resn`; use the complete shape written
  by `scene.selection.selector`.
- `residue`: `kind`, `structureId`, `model`, `chain`, `resi`, and optionally
  `icode` and `resn`.
- `chain`: `kind`, `structureId`, `model`, and `chain`.
- `residue-range`: `kind`, `structureId`, `model`, `chain`, plus inclusive
  `start` and `end` objects such as `{ "resi": 10 }`. An optional `icode` on
  an endpoint narrows that boundary.
- `ligands`: `kind` and `structureId`, with optional `model`. This matches all
  `HETATM` atoms except common water residue names (`HOH`, `WAT`, `H2O`, and
  `DOD`).
- `within`: `kind`, `structureId`, a positive `cutoff` in Å (at most 100), and
  a `target` whose kind is `atom`, `residue`, or `ligands`. Matching is based
  on coordinates in the same model and includes target atoms themselves.

Queries can be valid but empty. A selector with a missing/unsupported field or
a stale `structureId` is retained in the document and shown as invalid so an
agent can repair it. The browser clears `scene.savedSelections` when its own
PDB import/fetch workflow replaces the structure. If an agent replaces
`structure`, it should likewise remove or rewrite selectors tied to the old
structure. Preserve unknown fields on selection records and selectors.

## Measurements and annotations

Persistent geometric annotations live in `scene.measurements`. Each record has
a stable `id`, a `type` (`distance`, `angle`, or `dihedral`), and an ordered
`atoms` array containing 2, 3, or 4 atom selectors respectively. `label` and
`note` are optional editable strings. Values are intentionally not persisted;
the viewer recomputes them from the embedded coordinates whenever it loads.

```json
{
  "id": "measurement-active-site-distance",
  "type": "distance",
  "atoms": [
    {
      "structureId": "structure-id",
      "model": 1,
      "chain": "A",
      "resi": 42,
      "icode": "",
      "atom": "CA",
      "altLoc": "",
      "serial": 317
    },
    {
      "structureId": "structure-id",
      "model": 1,
      "chain": "A",
      "resi": 57,
      "icode": "",
      "atom": "O",
      "altLoc": "",
      "serial": 441
    }
  ],
  "label": "Active-site span",
  "note": "Compare after mutation."
}
```

Atom order matters for angles and dihedrals. Use the complete atom selector
shape shown above, keep every selector tied to the current `structure.id`, and
preserve unknown fields on both the record and document. When replacing the
embedded structure, remove measurements whose selectors refer to the old
structure; the browser's structure import workflow clears them automatically.

## Ligand and binding-pocket analysis

The optional current analysis state lives in `scene.ligandAnalysis`. Derived
ligand lists, residues, and atom contacts are never persisted; the browser
recomputes them locally from the embedded PDB coordinates.

```json
{
  "selectedLigand": {
    "structureId": "structure-id",
    "model": 1,
    "chain": "B",
    "resi": 401,
    "icode": "",
    "resn": "ATP"
  },
  "cutoff": 4.0,
  "showLigand": true,
  "showPocket": true,
  "showContacts": true,
  "polarOnly": false
}
```

Ligand instances are non-water `HETATM` residues grouped by model, chain,
residue number, insertion code, and residue name. `cutoff` is bounded to
2.5–8.0 Å. The visibility booleans control ligand and pocket emphasis and
contact lines; `polarOnly` limits lines, not the computed residue list.

The classifications are deliberately geometric heuristics. A close contact is
within the two atoms' van der Waals radii plus 0.5 Å. A plausible polar
contact is an N/O/S pair within 3.5 Å. These labels do not assign bond order,
donor/acceptor roles, hydrogen bonds, energies, protonation, or solvent
accessibility. Preserve unknown fields. Set `selectedLigand` to `null` to clear
the active analysis; when replacing the structure, clear it or retarget it to
the new `structure.id`.
## Saved views and stories

Presentation bookmarks live in `scene.savedViews`. The array is displayed in ascending
`order`; keep each `id` stable when editing a view. A saved view stores presentation state,
not molecular coordinates. `structureId` ties it to the structure it was captured from.

```json
{
  "id": "view-active-site",
  "title": "Active site",
  "narrative": "The highlighted residues surround the bound ligand.",
  "order": 0,
  "structureId": "structure-id",
  "snapshot": {
    "representation": "sticks",
    "colorMode": "element",
    "background": "#07111f",
    "showHydrogens": false,
    "showWater": false,
    "selection": null,
    "customColors": [],
    "camera": { "view": [0, 0, 0, 35, 0, 0, 0, 1] }
  }
}
```

`narrative` is optional and is shown with the title in story mode. A snapshot may also
contain compatible active analysis/highlight state. Never put `savedViews`, structure data,
measurements, saved selections, metadata, or other document content inside a snapshot.
Applying a view changes only the presentation fields explicitly owned by its snapshot, so
unrelated and unknown scene fields survive. Structure import clears saved views because
their selectors and cameras are not guaranteed to be compatible with replacement coordinates.

Valid `scene.representation` values are `cartoon`, `ball-and-stick`, `sticks`,
`spacefill`, `lines`, and `surface`. Valid `scene.colorMode` values are `element`,
`chain`, `residue`, and `uniform`. CSS hex colors are recommended.

The WebGL camera is stored as `scene.camera.view`, an eight-number 3Dmol.js view
array. Preserve that array unless the user asks to change or reset the view. Set
it to `null` to have the browser fit the whole structure on its next refresh.

## Browser API

When operating the open page directly:

```js
window.molhtml.document
window.molhtml.getSelection()
window.molhtml.getMeasurements()
window.molhtml.getSavedSelections()
window.molhtml.listLigands()
window.molhtml.getLigandAnalysis()
window.molhtml.getMetadata()
window.molhtml.getDataQuality()
window.molhtml.getSavedViews()
window.molhtml.fetchPDB('4HHB')
window.molhtml.searchPDB('human hemoglobin')
window.molhtml.selectAtom(317)
window.molhtml.colorSelection('#ff0000', 'atom')
window.molhtml.beginMeasurement('distance')
window.molhtml.cancelMeasurement()
window.molhtml.addMeasurement('distance', [317, 441], { label: 'Active-site span' })
window.molhtml.updateMeasurement('measurement-id', { note: 'Reviewed' })
window.molhtml.removeMeasurement('measurement-id')
window.molhtml.clearMeasurements()
window.molhtml.saveCurrentSelection('Catalytic residue', 'residue')
window.molhtml.addSavedSelection('Chain A range', {
  kind: 'residue-range', structureId: window.molhtml.document.structure.id,
  model: 1, chain: 'A', start: { resi: 20 }, end: { resi: 40 }
})
window.molhtml.renameSavedSelection('selection-id', 'New name')
window.molhtml.getSavedSelectionMatch('selection-id')
window.molhtml.highlightSavedSelection('selection-id', true)
window.molhtml.clearSavedSelectionHighlight()
window.molhtml.removeSavedSelection('selection-id')
window.molhtml.clearSavedSelections()
window.molhtml.selectLigand(ligandKeyOrSelector)
window.molhtml.setLigandAnalysis({ cutoff: 5, showContacts: false })
window.molhtml.analyzeLigand(ligandKeyOrSelector, 4)
window.molhtml.focusLigandAnalysis()
window.molhtml.clearLigandAnalysis()
window.molhtml.createSavedView({ title: 'Overview', narrative: 'Opening view' })
window.molhtml.updateSavedView('view-id', { title: 'Active site', narrative: 'Look here' })
window.molhtml.recaptureSavedView('view-id')
window.molhtml.applySavedView('view-id')
window.molhtml.moveSavedView('view-id', -1)
window.molhtml.duplicateSavedView('view-id')
window.molhtml.removeSavedView('view-id')
window.molhtml.startStory('view-id')
window.molhtml.previousStoryView()
window.molhtml.nextStoryView()
window.molhtml.exitStory()
window.molhtml.loadDocument(updatedDocument, 'agent')
window.molhtml.serialize()
window.molhtml.save()
```
