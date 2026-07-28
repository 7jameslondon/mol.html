# mol.html

`mol.html` is a molecular viewer whose final document is one self-contained,
self-editing HTML file. The HTML carries the viewer, editor, PDB coordinates,
selection, colors, camera, and agent-readable JSON state.

## Build

Install the pinned dependency, then build and verify the standalone artifact:

```powershell
pnpm install
node scripts/build.mjs
node scripts/verify.mjs
```

The result is `dist/example.mol.html`. Open that file in a modern browser.
The build embeds 3Dmol.js 2.5.5 and its license notices directly in that file,
so the finished viewer does not need a network connection.

## Use

- Use the **Home** ribbon for common commands. Buttons with detailed settings
  open a contextual sidebar; click the active button again or use its close
  control to return to a full-width viewer.
- Drag to rotate, Shift-drag or right-drag to pan, and scroll to zoom.
- Click an atom to write its exact identity into the document state.
- Apply colors to the selected atom, its residue, or its chain.
- Switch between cartoon, ball-and-stick, sticks, spacefill, lines, and a
  molecular surface.
- Open any PDB file; its coordinates become embedded in the next saved HTML.
- Fetch a classic four-character PDB ID directly from RCSB, or use the Fetch
  sidebar's full-text search to find entries by molecule, organism, author,
  ligand, or other terms. Search results are temporary; the selected structure,
  its coordinates, and source provenance become embedded in the next saved HTML.
- Press `Ctrl+S` or use **Save**. Chromium browsers can rewrite a selected file
  in place; other browsers download a new complete copy.

The included starter structure has synthetic demonstration coordinates and must
not be used for scientific analysis.

## Renderer

Molecular graphics, WebGL camera controls, picking, cartoons, sticks, spheres,
and surfaces are provided by the bundled [3Dmol.js](https://3dmol.csb.pitt.edu/)
2.5.5 library. The surrounding document model, editing UI, self-save behavior,
and agent round trip are implemented by this project.

Fetching uses the official [RCSB file download service](https://www.rcsb.org/docs/programmatic-access/file-download-services)
and its uncompressed legacy-PDB URL. General discovery uses the official RCSB
Search API and Data API. An internet connection is needed for searching and
fetching, but not after the HTML is saved.
Entries offered only as PDBx/mmCIF are reported clearly and are not yet
supported by this PDB-format-only document version.

## Agent editing

See [AGENT_GUIDE.md](AGENT_GUIDE.md). Agents should edit only the plaintext
`#molhtml-doc` JSON block, increment `revision`, and preserve unknown fields.
