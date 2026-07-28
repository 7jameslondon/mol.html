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
window.molview.loadDocument(updatedDocument, 'agent')
window.molview.serialize()
window.molview.save()
```
