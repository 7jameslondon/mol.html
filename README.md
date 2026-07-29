# mol.html

[![Validate](https://github.com/7jameslondon/mol.html/actions/workflows/ci.yml/badge.svg)](https://github.com/7jameslondon/mol.html/actions/workflows/ci.yml)

`mol.html` is a molecular viewer whose final document is one self-contained,
self-editing HTML file. The HTML carries the viewer, editor, PDB or PDBx/mmCIF coordinates,
selection, colors, camera, and agent-readable JSON state.

## Website

The latest build from `main` is published at
[7jameslondon.github.io/mol.html](https://7jameslondon.github.io/mol.html/).
The same self-contained artifact is also available as
[`example.mol.html`](https://7jameslondon.github.io/mol.html/example.mol.html).

## Development

### Prerequisites

Install these tools before setting up the project:

- [Git](https://git-scm.com/) to work with the repository.
- [Node.js](https://nodejs.org/) 24.x. The supported range is `>=24 <25`.
- [pnpm](https://pnpm.io/installation) 11.9.0. The package manager version is
  pinned in `package.json` and CI.

This project uses pnpm directly; it does not require `npx`. Confirm that the
expected tools are available before continuing:

```powershell
node --version
pnpm --version
```

The Node.js version should begin with `v24.` and the pnpm version should be
`11.9.0`.

### First-time setup

Install the pinned project dependencies, then install the Chromium binary used
by the browser tests:

```powershell
pnpm install --frozen-lockfile
pnpm setup:e2e
```

Both commands require an internet connection the first time. The frozen
lockfile option installs the versions recorded in `pnpm-lock.yaml` and fails
instead of rewriting the lockfile if it disagrees with `package.json`.
`pnpm setup:e2e` is a separate, explicit browser download; dependency
installation never downloads a browser implicitly.

### Build and test

Run the complete local quality gate:

```powershell
pnpm check
```

The result is `dist/example.mol.html`. Open that file in a modern browser.
The build embeds the project's MIT license and the complete notices for
3Dmol.js 2.5.5 and its bundled dependencies directly in that file, so the
finished viewer does not need a network connection. The build is pinned to the
audited renderer bundle and fails if its code or dependency set changes without
a corresponding license review.

`pnpm check` builds once, verifies a second byte-identical build, runs the pure
model and adversarial single-file tests, enforces the artifact budget, and then
exercises the built `file://` artifact in pinned Chromium.

Focused commands are also available:

| Command | Purpose |
| --- | --- |
| `pnpm build` | Build `dist/example.mol.html`. |
| `pnpm test:model` | Run the pure model tests. |
| `pnpm test:artifact` | Run the built single-file artifact tests. |
| `pnpm test:e2e` | Exercise the built artifact in the configured browser. |
| `pnpm test:performance` | Run the scheduled performance checks. |

Model and artifact checks require no network. Browser tests abort unexpected
HTTP(S) traffic and mock exact RCSB coordinate, Search API, and Data API
requests. Test output is isolated under Playwright's per-test output directory.
CI retains failure traces, screenshots, video, and console diagnostics; local
runs keep screenshots and an HTML report without the trace/video overhead.

Once built, `dist/example.mol.html` does not require Node.js, pnpm, or a network
connection to open. The development tools are needed only to install
dependencies, rebuild the file, and run checks.

### Troubleshooting

- If a command reports an unsupported Node.js version, confirm that
  `node --version` reports Node.js 24.x.
- If pnpm reports a package-manager version mismatch, confirm that
  `pnpm --version` reports 11.9.0.
- If `pnpm install --frozen-lockfile` reports that the lockfile is outdated, do
  not bypass the check for a normal setup. `package.json` and `pnpm-lock.yaml`
  must be updated together when dependencies are intentionally changed.
- If a browser test reports that Chromium is missing, run `pnpm setup:e2e`.

## Continuous integration

GitHub Actions runs the same required `pnpm check` gate for pull requests and
every commit to `main`. It uses read-only repository permission, immutable
action SHAs, a frozen lockfile, and no release credentials. A weekly and manual
job adds Firefox/WebKit smoke coverage, timing observations, and a masked
Chromium UI snapshot.

After the `validate` job is stable on the repository, configure branch
protection to require it and require the branch to be current before merge (or
use a merge queue). Dependency update automation is defined for npm packages
and pinned GitHub Actions.

Native file permissions and real-GPU behavior remain release checks; see
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## Use

- Use the **Home** ribbon for common commands. Buttons with detailed settings
  open a contextual sidebar; click the active button again or use its close
  control to return to a full-width viewer.
- Drag to rotate, Shift-drag or right-drag to pan, and scroll to zoom.
- Click an atom to write its exact identity into the document state.
- Apply colors to the selected atom, residue, author chain, molecular instance,
  entity, or functional role.
- Switch between cartoon, ball-and-stick, sticks, spacefill, lines, and a
  molecular surface.
- Open a PDB or text PDBx/mmCIF file; its original coordinates become embedded
  in the next saved HTML.
- Fetch a classic four-character PDB ID directly from RCSB, or use the Fetch
  sidebar's full-text search to find entries by molecule, organism, author,
  ligand, or other terms. Search results are temporary; the selected structure,
  its coordinates, and source provenance become embedded in the next saved HTML.
- Press `Ctrl+S` or use **Save**. Chromium browsers can rewrite a selected file
  in place; other browsers download a new complete copy.

The included starter structure is the experimentally determined Dickerson–Drew
B-DNA dodecamer ([PDB 1BNA](https://www.rcsb.org/structure/1BNA)). Its embedded
coordinate payload retains all 486 DNA atoms while omitting the 80
crystallographic waters and non-coordinate PDB headers. RCSB metadata and file
provenance remain embedded in the molecular document.

## Renderer

Molecular graphics, WebGL camera controls, picking, cartoons, sticks, spheres,
and surfaces are provided by the bundled [3Dmol.js](https://3dmol.csb.pitt.edu/)
2.5.5 library. The surrounding document model, editing UI, self-save behavior,
and agent round trip are implemented by this project.

Fetching uses the official [RCSB file download service](https://www.rcsb.org/docs/programmatic-access/file-download-services),
trying the uncompressed legacy-PDB file first and text PDBx/mmCIF when legacy
coordinates are unavailable. General discovery uses the official RCSB
Search API and Data API. An internet connection is needed for searching and
fetching, but not after the HTML is saved.

PDB and mmCIF are normalized into a custom runtime model that keeps atom,
residue, molecular-instance, entity, connected-component, assembly, and source
identity concepts separate. The original coordinate text remains canonical and
the derived model is not serialized. Biological assembly records reference base
instances and composed operator transforms without copying atom topology. See
[`docs/adr/0001-normalized-molecular-model.md`](docs/adr/0001-normalized-molecular-model.md).

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
