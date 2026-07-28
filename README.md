# mol.html

`mol.html` is a molecular viewer whose final document is one self-contained,
self-editing HTML file. The HTML carries the viewer, editor, PDB coordinates,
selection, colors, camera, and agent-readable JSON state.

## Build

Install the pinned dependency, then build and verify the standalone artifact:

```powershell
pnpm install --frozen-lockfile
node scripts/build.mjs
node scripts/verify.mjs
node scripts/test-license-integrity.mjs
```

The result is `dist/example.mol.html`. Open that file in a modern browser.
The build embeds the project's MIT license and the complete notices for
3Dmol.js 2.5.5 and its bundled dependencies directly in that file, so the
finished viewer does not need a network connection. The build is pinned to the
audited renderer bundle and fails if its code or dependency set changes without
a corresponding license review.

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

## License

The mol.html project code is available under the [MIT License](LICENSE).
Third-party terms and attributions are recorded in
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt). Every built `.mol.html`
file embeds both texts in a canonical, integrity-checked notice block. Dependency
or renderer-bundle changes require an explicit review and update of
`legal/third-party-manifest.json`; otherwise the build fails.
