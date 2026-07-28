# molview/file agent guide

The complete molecular document is stored in one plaintext block inside the
HTML file:

```html
<script type="application/molview+json" id="molview-doc">
{ "format": "molview/document", "version": 1, ... }
</script>
```

Edit only the JSON inside this block. Leave the application shell untouched.
Escape every `<` in JSON strings as `\u003c` so data can never terminate the
script block. Preserve fields you do not understand.

## Change protocol

For every edit:

1. Verify `format` is `molview/document` and `version` is `1`.
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

Valid `scene.representation` values are `cartoon`, `ball-and-stick`, `sticks`,
`spacefill`, `lines`, and `surface`. Valid `scene.colorMode` values are `element`,
`chain`, `residue`, and `uniform`. CSS hex colors are recommended.

The WebGL camera is stored as `scene.camera.view`, an eight-number 3Dmol.js view
array. Preserve that array unless the user asks to change or reset the view. Set
it to `null` to have the browser fit the whole structure on its next refresh.

## Browser API

When operating the open page directly:

```js
window.molview.document
window.molview.getSelection()
window.molview.getMeasurements()
window.molview.getSavedSelections()
window.molview.fetchPDB('4HHB')
window.molview.searchPDB('human hemoglobin')
window.molview.selectAtom(317)
window.molview.colorSelection('#ff0000', 'atom')
window.molview.beginMeasurement('distance')
window.molview.cancelMeasurement()
window.molview.addMeasurement('distance', [317, 441], { label: 'Active-site span' })
window.molview.updateMeasurement('measurement-id', { note: 'Reviewed' })
window.molview.removeMeasurement('measurement-id')
window.molview.clearMeasurements()
window.molview.saveCurrentSelection('Catalytic residue', 'residue')
window.molview.addSavedSelection('Chain A range', {
  kind: 'residue-range', structureId: window.molview.document.structure.id,
  model: 1, chain: 'A', start: { resi: 20 }, end: { resi: 40 }
})
window.molview.renameSavedSelection('selection-id', 'New name')
window.molview.getSavedSelectionMatch('selection-id')
window.molview.highlightSavedSelection('selection-id', true)
window.molview.clearSavedSelectionHighlight()
window.molview.removeSavedSelection('selection-id')
window.molview.clearSavedSelections()
window.molview.loadDocument(updatedDocument, 'agent')
window.molview.serialize()
window.molview.save()
```
